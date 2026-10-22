const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

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

// ---------------- WebSocket 连接处理 ----------------
wss.on('connection', (ws, req) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const remoteIp = req.socket.remoteAddress || '';
  
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
      }
    } catch (err) {
      console.error('[WS] 无法解析客户端消息:', err.message);
    }
  });

  ws.on('close', () => {
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
