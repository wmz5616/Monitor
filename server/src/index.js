const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

// RFC 6238 TOTP Helpers
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToBytes(base32) {
  const clean = String(base32 || '').toUpperCase().replace(/[\s-]/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_CHARS.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
  }
  return bytes;
}

function computeTotp(secretKey, timeStepOffset = 0) {
  try {
    const step = 30;
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / step) + timeStepOffset;

    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(counter));

    const keyBytes = base32ToBytes(secretKey);
    const hmac = crypto.createHmac('sha1', keyBytes).update(buffer).digest();

    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    return (binary % 1000000).toString().padStart(6, '0');
  } catch (e) {
    return null;
  }
}

function verifyTotp(secretKey, inputCode) {
  const clean = String(inputCode || '').trim();
  if (clean.length !== 6) return false;
  for (const offset of [0, -1, 1]) {
    if (computeTotp(secretKey, offset) === clean) {
      return true;
    }
  }
  return false;
}

const NotificationStore = require('./notificationStore');
const TaskManager = require('./taskManager');
const DeviceManager = require('./deviceManager');

const PORT = process.env.PORT || 7788;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const notificationStore = new NotificationStore();
const taskManager = new TaskManager(notificationStore);
const deviceManager = new DeviceManager();

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ ok: false, error: '无效的 JSON 请求体' });
  }
  next();
});

// 托管前端静态资源
const publicPath = path.join(__dirname, '..', '..', 'public');
app.use(express.static(publicPath));

// WebSocket 广播助手
function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(payload);
      } catch (err) {
        console.error('[WS] 发送数据失败:', err.message);
      }
    }
  }
}

// 监听任务管理器事件并广播
taskManager.on('task:created', (task) => broadcast('task:created', task));
taskManager.on('task:status', (task) => broadcast('task:status', task));
taskManager.on('task:log', (log) => broadcast('task:log', log));

// ---------------- REST API ----------------

// 获取系统网络与连接状态
app.get('/api/status', (req, res) => {
  const ips = deviceManager.getLocalIpAddresses();
  const devices = deviceManager.getConnectedDevices();
  const tasks = taskManager.getAllTasks();
  const unreadCount = notificationStore.list({ unreadOnly: true }).length;

  res.json({
    ok: true,
    port: PORT,
    ips,
    devices,
    runningTasksCount: tasks.filter(t => t.status === 'running').length,
    unreadNotificationsCount: unreadCount,
    serverTime: Date.now()
  });
});

// 获取通知列表
app.get('/api/notifications', (req, res) => {
  const { sourceType, unreadOnly } = req.query;
  const list = notificationStore.list({
    sourceType,
    unreadOnly: unreadOnly === 'true'
  });
  res.json({ ok: true, data: list });
});

// 接收外部（如 Android 手机、Webhook、CLI）推送过来的新通知
app.post('/api/notifications', (req, res) => {
  const { title, content, sourceType, deviceId, deviceName, packageName, level, actions, code } = req.body;
  if (!title && !content) {
    return res.status(400).json({ ok: false, error: '标题与内容不能同时为空' });
  }

  const item = notificationStore.add({
    title,
    content,
    sourceType: sourceType || 'app',
    deviceId: deviceId || 'remote-device',
    deviceName: deviceName || '关联设备',
    packageName,
    level,
    actions,
    code
  });

  broadcast('notification:new', item);
  res.json({ ok: true, data: item });
});

// 标记通知为已读
app.post('/api/notifications/:id/read', (req, res) => {
  const success = notificationStore.markRead(req.params.id);
  if (success) {
    broadcast('notification:read', { id: req.params.id });
    res.json({ ok: true });
  } else {
    res.status(404).json({ ok: false, error: '未找到该通知' });
  }
});

// 标记所有通知为已读
app.post('/api/notifications/read-all', (req, res) => {
  notificationStore.markAllRead();
  broadcast('notification:read_all', {});
  res.json({ ok: true });
});

// 消除/删除通知
app.delete('/api/notifications/:id', (req, res) => {
  const removed = notificationStore.dismiss(req.params.id);
  if (removed) {
    broadcast('notification:dismissed', { id: req.params.id });
    res.json({ ok: true, data: removed });
  } else {
    res.status(404).json({ ok: false, error: '未找到该通知' });
  }
});

// 清空所有通知
app.delete('/api/notifications', (req, res) => {
  notificationStore.clear();
  broadcast('notification:cleared', {});
  res.json({ ok: true });
});

// 对通知执行快捷操作（如回复、重试、远程指令）
app.post('/api/notifications/:id/action', (req, res) => {
  const { actionId, replyText } = req.body;
  const notif = notificationStore.get(req.params.id);
  if (!notif) {
    return res.status(404).json({ ok: false, error: '通知不存在' });
  }

  // 如果操作是针对任务的重新运行
  if (actionId && actionId.startsWith('restart_')) {
    const taskId = actionId.replace('restart_', '');
    try {
      const task = taskManager.restartTask(taskId);
      return res.json({ ok: true, message: '任务已重新开始运行', data: taskManager.serializeTask(task) });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  }

  // 广播此操作到所有客户端（包括关联的 Android 客户端进行真实回复模拟）
  broadcast('notification:action_performed', {
    notificationId: notif.id,
    actionId,
    replyText,
    timestamp: Date.now()
  });

  res.json({
    ok: true,
    message: replyText ? `已发送回复: "${replyText}"` : '操作指令已分发'
  });
});

// ---------------- 任务控制 API ----------------

// 获取所有任务
app.get('/api/tasks', (req, res) => {
  const tasks = taskManager.getAllTasks();
  res.json({ ok: true, data: tasks });
});

// 获取某个任务的完整日志
app.get('/api/tasks/:id/logs', (req, res) => {
  const task = taskManager.getTask(req.params.id);
  if (!task) {
    return res.status(404).json({ ok: false, error: '任务不存在' });
  }
  res.json({ ok: true, data: task.logs });
});

// 从手机或前端直接下发并在电脑上执行新命令
app.post('/api/tasks/run', (req, res) => {
  const { command, name, cwd } = req.body;
  if (!command || typeof command !== 'string' || command.trim() === '') {
    return res.status(400).json({ ok: false, error: 'command 不能为空' });
  }

  // 安全防御：非本机 IP 必须携带房间内已配对的合法 x-pair-code，杜绝局域网未授权设备盲执行命令
  const clientIp = req.ip || req.socket.remoteAddress || '';
  const isLocal = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp.includes('127.0.0.1');
  const reqPairCode = req.headers['x-pair-code'] || req.body.pairCode;
  if (!isLocal && (!reqPairCode || !pairRooms.has(reqPairCode))) {
    return res.status(403).json({ ok: false, error: '未授权：非本机执行系统命令必须提供已配对的配对码 (Header: x-pair-code)' });
  }

  try {
    const task = taskManager.runTask({
      command: command.trim(),
      name: name || command.trim().slice(0, 30),
      cwd: cwd || process.cwd()
    });
    res.json({ ok: true, data: taskManager.serializeTask(task) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 终止正在运行的任务
app.post('/api/tasks/:id/kill', (req, res) => {
  const ok = taskManager.killTask(req.params.id);
  if (ok) {
    res.json({ ok: true, message: '终止信号已发送' });
  } else {
    res.status(400).json({ ok: false, error: '未能终止任务，任务可能已结束或不存在' });
  }
});

// 重新运行任务
app.post('/api/tasks/:id/restart', (req, res) => {
  try {
    const task = taskManager.restartTask(req.params.id);
    if (!task) {
      return res.status(404).json({ ok: false, error: '任务不存在' });
    }
    res.json({ ok: true, data: taskManager.serializeTask(task) });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 配对房间管理: pairCode -> Map<clientId, { ws, role, deviceName, battery, isCharging, signalDbm, permission, lastSeen }>
const pairRooms = new Map();
const socketToClient = new Map(); // ws -> clientId
const clientMeta = new Map();     // clientId -> { ws, pairCode, role, ... }

function getRoomClients(pairCode) {
  if (!pairRooms.has(pairCode)) {
    pairRooms.set(pairCode, new Map());
  }
  return pairRooms.get(pairCode);
}

function broadcastToRoom(pairCode, event, data, excludeWs = null) {
  if (!pairCode || !pairRooms.has(pairCode)) return;
  const room = pairRooms.get(pairCode);
  const payload = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const [, peer] of room) {
    if (peer.ws !== excludeWs && peer.ws.readyState === WebSocket.OPEN) {
      try {
        peer.ws.send(payload);
      } catch (err) {
        console.error('[WS-Room] 发送失败:', err.message);
      }
    }
  }
}

// 检查配对码状态
app.get('/api/pair/status/:code', (req, res) => {
  const code = req.params.code;
  if (!code || code.length < 6) {
    return res.status(400).json({ ok: false, error: '配对码格式不正确' });
  }
  const room = pairRooms.get(code);
  const peers = [];
  if (room) {
    for (const [cId, p] of room) {
      peers.push({
        clientId: cId,
        role: p.role,
        deviceName: p.deviceName,
        battery: p.battery,
        isCharging: p.isCharging,
        signalDbm: p.signalDbm,
        permission: p.permission,
        lastSeen: p.lastSeen
      });
    }
  }
  res.json({ ok: true, pairCode: code, onlineCount: peers.length, peers });
});

// 验证 6 位动态验证码并查找匹配的另一部设备 (RFC 6238 TOTP)
app.post('/api/pair/verify_totp', (req, res) => {
  const { code } = req.body;
  const cleanCode = String(code || '').trim();
  if (cleanCode.length !== 6) {
    return res.status(400).json({ ok: false, error: '请输入 6 位动态验证码' });
  }

  // 1. 遍历当前已连入的另一部设备 B
  for (const [, p] of clientMeta) {
    if (p.role === 'B' && p.secretKey) {
      if (verifyTotp(p.secretKey, cleanCode)) {
        return res.json({
          ok: true,
          secretKey: p.secretKey,
          pairCode: p.pairCode || p.secretKey,
          deviceName: p.deviceName,
          battery: p.battery,
          isCharging: p.isCharging,
          signalDbm: p.signalDbm
        });
      }
    }
  }

  // 2. 遍历房间内已有对端
  for (const [, room] of pairRooms) {
    for (const [, p] of room) {
      if (p.role === 'B' && p.secretKey) {
        if (verifyTotp(p.secretKey, cleanCode)) {
          return res.json({
            ok: true,
            secretKey: p.secretKey,
            pairCode: p.pairCode || p.secretKey,
            deviceName: p.deviceName,
            battery: p.battery,
            isCharging: p.isCharging,
            signalDbm: p.signalDbm
          });
        }
      }
    }
  }

  res.status(404).json({
    ok: false,
    error: '未匹配到对应的另一部设备或动态码已过期，请核对另一部设备当前 30 秒动态码'
  });
});

// 验证 16 位设置密钥并查找匹配的另一部设备 B (严格对端存在性校验)
app.post('/api/pair/verify_secret', (req, res) => {
  const { secretKey } = req.body;
  const cleanKey = String(secretKey || '').toUpperCase().replace(/[^A-Z2-7]/g, '').trim();
  if (cleanKey.length !== 16) {
    return res.status(400).json({ ok: false, error: '请输入标准的 16 位 Base32 密钥 (A-Z, 2-7)' });
  }

  // 1. 遍历当前已连入的另一部设备 B
  for (const [, p] of clientMeta) {
    if (p.role === 'B' && p.secretKey && p.secretKey.toUpperCase() === cleanKey) {
      return res.json({
        ok: true,
        secretKey: p.secretKey,
        pairCode: p.pairCode || p.secretKey,
        deviceName: p.deviceName || '另一部设备',
        battery: p.battery,
        isCharging: p.isCharging,
        signalDbm: p.signalDbm
      });
    }
  }

  // 2. 遍历房间内已有对端
  for (const [, room] of pairRooms) {
    for (const [, p] of room) {
      if (p.role === 'B' && p.secretKey && p.secretKey.toUpperCase() === cleanKey) {
        return res.json({
          ok: true,
          secretKey: p.secretKey,
          pairCode: p.pairCode || p.secretKey,
          deviceName: p.deviceName || '另一部设备',
          battery: p.battery,
          isCharging: p.isCharging,
          signalDbm: p.signalDbm
        });
      }
    }
  }

  res.status(404).json({
    ok: false,
    error: '未匹配到对应的另一部设备，请确保另一部设备处于运行状态且密钥一致'
  });
});

// ---------------- WebSocket 连接处理 ----------------
wss.on('connection', (ws, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const remoteIp = req.socket.remoteAddress || '';
  socketToClient.set(ws, clientId);

  deviceManager.registerDevice(clientId, {
    clientType: 'unknown',
    ip: remoteIp,
    userAgent: req.headers['user-agent'] || ''
  });

  // 发送欢迎及初始状态包
  ws.send(JSON.stringify({
    event: 'init',
    data: {
      clientId,
      notifications: notificationStore.list(),
      tasks: taskManager.getAllTasks(),
      ips: deviceManager.getLocalIpAddresses()
    }
  }));

  broadcast('device:connected', { clientId, count: wss.clients.size });

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());
      deviceManager.updateActivity(clientId);

      if (msg.type === 'register') {
        deviceManager.registerDevice(clientId, {
          name: msg.name,
          clientType: msg.clientType,
          ip: remoteIp,
          userAgent: req.headers['user-agent'] || ''
        });
        broadcast('device:update', { devices: deviceManager.getConnectedDevices() });
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ event: 'pong', timestamp: Date.now() }));
      } else if (msg.type === 'pair:verify_totp') {
        const { code } = msg;
        const cleanCode = String(code || '').trim();
        let matched = null;
        for (const [, p] of clientMeta) {
          if (p.role === 'B' && p.secretKey && verifyTotp(p.secretKey, cleanCode)) {
            matched = p;
            break;
          }
        }
        if (matched) {
          ws.send(JSON.stringify({
            event: 'pair:totp_verified',
            data: {
              ok: true,
              secretKey: matched.secretKey,
              pairCode: matched.pairCode || matched.secretKey,
              deviceName: matched.deviceName,
              battery: matched.battery,
              isCharging: matched.isCharging,
              signalDbm: matched.signalDbm
            }
          }));
        } else {
          ws.send(JSON.stringify({
            event: 'pair:totp_verified',
            data: { ok: false, error: '未匹配到另一部设备或动态码已过期' }
          }));
        }
      } else if (msg.type === 'pair:join') {
        // 加入配对房间
        const { pairCode, secretKey, role, deviceName, battery, isCharging, signalDbm, permission } = msg;
        const effectiveKey = secretKey || (role === 'B' && pairCode && pairCode.length >= 10 ? pairCode : null);
        if (pairCode && pairCode.length >= 6) {
          const room = getRoomClients(pairCode);
          const peerInfo = {
            ws,
            clientId,
            pairCode,
            secretKey: effectiveKey,
            role: role || 'A',
            deviceName: deviceName || (role === 'B' ? '另一部设备' : '主力机'),
            battery: battery !== undefined ? battery : null,
            isCharging: !!isCharging,
            signalDbm: signalDbm !== undefined ? signalDbm : null,
            permission: permission !== undefined ? permission : null,
            lastSeen: Date.now()
          };
          room.set(clientId, peerInfo);
          clientMeta.set(clientId, peerInfo);

          // 收集房间内已有其他端信息回复给当前连入者
          const existingPeers = [];
          for (const [cId, p] of room) {
            if (cId !== clientId) {
              existingPeers.push({
                clientId: cId,
                role: p.role,
                deviceName: p.deviceName,
                battery: p.battery,
                isCharging: p.isCharging,
                signalDbm: p.signalDbm,
                permission: p.permission,
                lastSeen: p.lastSeen
              });
            }
          }

          ws.send(JSON.stringify({
            event: 'pair:joined',
            data: { pairCode, peers: existingPeers, timestamp: Date.now() }
          }));

          // 向房间内其他设备广播有新成员连入/在线
          broadcastToRoom(pairCode, 'peer:heartbeat', {
            clientId,
            role: peerInfo.role,
            deviceName: peerInfo.deviceName,
            battery: peerInfo.battery,
            isCharging: peerInfo.isCharging,
            signalDbm: peerInfo.signalDbm,
            permission: peerInfo.permission,
            lastSeen: peerInfo.lastSeen,
            timestamp: Date.now()
          }, ws);
        }
      } else if (msg.type === 'heartbeat') {
        // 心跳包同步
        const { pairCode, role, deviceName, battery, isCharging, signalDbm, permission } = msg;
        if (pairCode && pairRooms.has(pairCode)) {
          const room = pairRooms.get(pairCode);
          if (room.has(clientId)) {
            const cur = room.get(clientId);
            cur.battery = battery !== undefined ? battery : cur.battery;
            cur.isCharging = isCharging !== undefined ? isCharging : cur.isCharging;
            cur.signalDbm = signalDbm !== undefined ? signalDbm : cur.signalDbm;
            cur.permission = permission !== undefined ? permission : cur.permission;
            cur.deviceName = deviceName || cur.deviceName;
            cur.lastSeen = Date.now();
          }
          // 转发心跳给房间内对端
          broadcastToRoom(pairCode, 'peer:heartbeat', {
            role,
            deviceName,
            battery,
            isCharging,
            signalDbm,
            permission,
            timestamp: Date.now()
          }, ws);
        }
      } else if (msg.type === 'relay:envelope') {
        // Blind End-to-End Encrypted Relay (零解密、零存储纯盲转中继)
        const { channelId, envelope } = msg;
        if (channelId && envelope) {
          broadcastToRoom(channelId, 'relay:envelope', { channelId, envelope, timestamp: Date.now() }, ws);
        }
      } else if (msg.type === 'notification:new') {
        const { pairCode, data } = msg;
        if (data) {
          const saved = notificationStore.add(data);
          if (pairCode) {
            broadcastToRoom(pairCode, 'notification:new', saved, ws);
          }
          broadcast('notification:new', saved);
        }
      } else if (msg.type === 'notification:read') {
        const { id, pairCode } = msg;
        if (id) {
          notificationStore.markRead(id);
          if (pairCode) {
            broadcastToRoom(pairCode, 'notification:read', { id }, ws);
          }
          broadcast('notification:read', { id });
        }
      } else if (msg.type === 'notification:dismiss') {
        const { id, pairCode } = msg;
        if (id) {
          notificationStore.dismiss(id);
          if (pairCode) {
            broadcastToRoom(pairCode, 'notification:dismissed', { id }, ws);
          }
          broadcast('notification:dismissed', { id });
        }
      } else if (msg.type === 'notification:clear_all') {
        const { pairCode } = msg;
        notificationStore.clear();
        if (pairCode) {
          broadcastToRoom(pairCode, 'notification:cleared', {}, ws);
        }
        broadcast('notification:cleared', {});
      } else if (msg.type === 'pair:leave') {
        const { pairCode, role } = msg;
        if (pairCode && pairRooms.has(pairCode)) {
          const room = pairRooms.get(pairCode);
          room.delete(clientId);
          broadcastToRoom(pairCode, 'peer:left', { role, clientId, timestamp: Date.now() });
        }
        clientMeta.delete(clientId);
      }
    } catch (err) {
      console.error('[WS] 无法解析客户端消息:', err.message);
    }
  });

  ws.on('close', () => {
    const meta = clientMeta.get(clientId);
    if (meta && meta.pairCode && pairRooms.has(meta.pairCode)) {
      const room = pairRooms.get(meta.pairCode);
      room.delete(clientId);
      broadcastToRoom(meta.pairCode, 'peer:left', { role: meta.role, clientId, timestamp: Date.now() });
      if (room.size === 0) {
        pairRooms.delete(meta.pairCode);
      }
    }
    clientMeta.delete(clientId);
    socketToClient.delete(ws);
    deviceManager.unregisterDevice(clientId);
    broadcast('device:disconnected', { clientId, count: wss.clients.size });
  });

  ws.on('error', (err) => {
    console.error(`[WS] 客户端 ${clientId} 错误:`, err.message);
  });
});

// 启动监听
server.listen(PORT, '0.0.0.0', () => {
  const ips = deviceManager.getLocalIpAddresses();
  console.log('====================================================');
  console.log(`[通知共享] 服务已启动: 端口 ${PORT}`);
  console.log(`[本地访问] http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log('[局域网/跨网设备访问地址]:');
    ips.forEach(item => {
      console.log(` - http://${item.address}:${PORT} (${item.type})`);
    });
  } else {
    console.log(` - http://<本机局域网IP>:${PORT}`);
  }
  console.log('====================================================');
});
