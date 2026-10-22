// 状态管理
const state = {
  currentTab: 'tab-tasks',
  tasks: [],
  notifications: [],
  devices: [],
  activeTaskId: null,
  filterSource: 'all',
  soundEnabled: true,
  audioCtx: null,
  activeReplyNotif: null
};

// 初始化音频上下文 (合成提示音，无需加载外部音频文件)
function playTone(type = 'success') {
  if (!state.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!state.audioCtx) {
      state.audioCtx = new AudioContext();
    }
    const ctx = state.audioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.25);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else {
      // 短信/通用提示
      osc.type = 'sine';
      osc.frequency.setValueAtTime(783.99, now); // G5
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch (e) {
    console.warn('[音频] 无法播放提示音:', e);
  }
}

// 浏览器原生系统通知支持
function triggerSystemNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body: body.length > 80 ? body.slice(0, 80) + '...' : body,
        icon: '/icons/icon.png'
      });
    } catch (e) {
      console.warn('[系统通知] 触发失败:', e);
    }
  }
}

// Toast 提示条
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'toast-item';
  item.textContent = message;

  if (type === 'error') {
    item.style.borderLeftColor = 'var(--color-danger)';
  } else if (type === 'success') {
    item.style.borderLeftColor = 'var(--color-success)';
  }

  container.appendChild(item);
  setTimeout(() => {
    item.style.opacity = '0';
    item.style.transition = 'opacity 0.3s ease';
    setTimeout(() => item.remove(), 300);
  }, 2600);
}

// 时间格式化助手
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  return isToday ? timeStr : `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

// DOM 加载完成
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupConnectionStatus();
  setupToolbarControls();
  setupNewTaskModal();
  setupReplyModal();
  setupFilters();

  // 启动实时客户端连接
  window.realtimeClient.connect();

  // 绑定 WebSocket 事件
  bindWsEvents();

  // 初始加载一次数据
  fetchInitialData();

  // 持续定时更新正在运行任务的计时器
  setInterval(updateRunningTimers, 1000);
});

// 标签切换
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
      state.currentTab = targetId;

      if (targetId === 'tab-devices') {
        renderQrCode();
      }
    });
  });
}

// 头部控制按钮
function setupToolbarControls() {
  const audioBtn = document.getElementById('audioToggleBtn');
  if (audioBtn) {
    audioBtn.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      audioBtn.classList.toggle('active', state.soundEnabled);
      showToast(state.soundEnabled ? '已开启任务完成声音提醒' : '已静音声音提醒');
    });
    audioBtn.classList.toggle('active', state.soundEnabled);
  }

  const notifBtn = document.getElementById('notifPermissionBtn');
  if (notifBtn) {
    notifBtn.addEventListener('click', async () => {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          showToast('已成功开启系统级通知权限', 'success');
          notifBtn.classList.add('active');
        } else {
          showToast('通知权限已被拒绝或忽略', 'error');
        }
      } else {
        showToast('当前浏览器不支持 Notification API', 'error');
      }
    });
  }

  document.getElementById('btnMarkAllRead')?.addEventListener('click', async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' });
    state.notifications.forEach(n => { n.read = true; });
    renderNotifications();
    updateBadges();
    showToast('已全部标记为已读');
  });

  document.getElementById('btnClearAllNotifs')?.addEventListener('click', async () => {
    if (confirm('确定要清空所有通知记录吗？')) {
      await fetch('/api/notifications', { method: 'DELETE' });
      state.notifications = [];
      renderNotifications();
      updateBadges();
      showToast('通知列表已清空');
    }
  });
}

// 连接状态监听
function setupConnectionStatus() {
  const pill = document.getElementById('connStatusPill');
  const dot = pill?.querySelector('.status-dot');
  const text = document.getElementById('connStatusText');

  window.realtimeClient.on('connection_change', ({ status }) => {
    if (status === 'connected') {
      dot?.classList.remove('disconnected');
      dot?.classList.add('connected');
      if (text) text.textContent = '实时在线';
    } else {
      dot?.classList.remove('connected');
      dot?.classList.add('disconnected');
      if (text) text.textContent = '重连中...';
    }
  });
}

// 绑定 WebSocket 事件
function bindWsEvents() {
  const ws = window.realtimeClient;

  // 初始化推送包
  ws.on('init', (data) => {
    if (data.tasks) state.tasks = data.tasks;
    if (data.notifications) state.notifications = data.notifications;
    renderTasks();
    renderNotifications();
    renderNetworkIps(data.ips || []);
    updateBadges();
  });

  // 任务创建
  ws.on('task:created', (task) => {
    state.tasks.unshift(task);
    renderTasks();
    updateBadges();
  });

  // 任务状态改变
  ws.on('task:status', (task) => {
    const idx = state.tasks.findIndex(t => t.id === task.id);
    if (idx !== -1) {
      state.tasks[idx] = task;
    } else {
      state.tasks.unshift(task);
    }
    renderTasks();
    updateBadges();

    // 如果是当前正在查看的抽屉
    if (state.activeTaskId === task.id) {
      updateDrawerHeader(task);
    }

    // 声音和系统通知
    if (task.status === 'completed') {
      playTone('success');
      triggerSystemNotification(`任务完成: ${task.name}`, `执行耗时: ${(task.durationMs / 1000).toFixed(1)} 秒`);
    } else if (task.status === 'failed') {
      playTone('error');
      triggerSystemNotification(`任务报错: ${task.name}`, `退出代码: ${task.exitCode}`);
    }
  });

  // 任务日志流
  ws.on('task:log', (log) => {
    if (state.activeTaskId === log.taskId) {
      appendLogToTerminal(log);
    }
  });

  // 新通知到来 (如手机短信、验证码、微信)
  ws.on('notification:new', (notif) => {
    state.notifications.unshift(notif);
    renderNotifications();
    updateBadges();
    playTone(notif.code ? 'success' : 'info');
    triggerSystemNotification(notif.title, notif.content);
    showToast(`收到新消息: ${notif.title}`);
  });

  // 通知消除或已读
  ws.on('notification:dismissed', ({ id }) => {
    state.notifications = state.notifications.filter(n => n.id !== id);
    renderNotifications();
    updateBadges();
  });

  ws.on('notification:read', ({ id }) => {
    const n = state.notifications.find(item => item.id === id);
    if (n) n.read = true;
    renderNotifications();
    updateBadges();
  });

  // 设备列表更新
  ws.on('device:update', ({ devices }) => {
    state.devices = devices;
    renderConnectedDevices();
  });
}

// 请求 REST API 加载初始数据
async function fetchInitialData() {
  try {
    const [tasksRes, notifsRes, statusRes] = await Promise.all([
      fetch('/api/tasks').then(r => r.json()),
      fetch('/api/notifications').then(r => r.json()),
      fetch('/api/status').then(r => r.json())
    ]);

    if (tasksRes.ok) state.tasks = tasksRes.data;
    if (notifsRes.ok) state.notifications = notifsRes.data;
    if (statusRes.ok) {
      renderNetworkIps(statusRes.ips || []);
      state.devices = statusRes.devices || [];
      renderConnectedDevices();
    }

    renderTasks();
    renderNotifications();
    updateBadges();
  } catch (err) {
    console.error('初始加载数据异常:', err);
  }
}

// 渲染任务列表
function renderTasks() {
  const container = document.getElementById('tasksListContainer');
  if (!container) return;

  if (state.tasks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
        </div>
        <h3>暂无正在监控的代码任务</h3>
        <p>在电脑终端输入: <code>notify-run python test.py</code> 或点击右上角下发新命令</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.tasks.map(task => {
    const isRunning = task.status === 'running';
    const statusText = {
      running: '运行中',
      completed: '已完成',
      failed: '执行出错',
      terminated: '已手动终止',
      pending: '等待中'
    }[task.status] || task.status;

    const durationSec = ((task.durationMs || (task.startTime ? Date.now() - task.startTime : 0)) / 1000).toFixed(1);

    return `
      <div class="task-card ${task.status}" data-task-id="${task.id}">
        <div class="task-card-header">
          <div class="task-card-title-group">
            <span class="status-tag ${task.status}">${statusText}</span>
            <span class="task-name" title="${escapeHtml(task.name)}">${escapeHtml(task.name)}</span>
          </div>
          <span class="task-time">${formatTime(task.startTime)}</span>
        </div>

        <div class="task-cmd-box">${escapeHtml(task.command)}</div>

        <div class="task-card-footer">
          <div class="task-meta-info">
            耗时: <span class="task-timer" data-start="${task.startTime}" data-status="${task.status}">${durationSec}s</span>
            ${task.exitCode !== null ? ` | 退出码: ${task.exitCode}` : ''}
          </div>
          <div class="task-action-btns">
            <button class="btn btn-sm btn-secondary" onclick="openTerminalDrawer('${task.id}')">查看日志</button>
            ${isRunning ? `
              <button class="btn btn-sm btn-danger" onclick="killTask('${task.id}')">终止</button>
            ` : `
              <button class="btn btn-sm btn-ghost" onclick="restartTask('${task.id}')">重新运行</button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 定时递增运行中任务的时间
function updateRunningTimers() {
  document.querySelectorAll('.task-timer').forEach(el => {
    const status = el.getAttribute('data-status');
    const start = parseInt(el.getAttribute('data-start'), 10);
    if (status === 'running' && start) {
      const sec = ((Date.now() - start) / 1000).toFixed(1);
      el.textContent = `${sec}s`;
    }
  });
}

// 终端抽屉管理
window.openTerminalDrawer = async function(taskId) {
  state.activeTaskId = taskId;
  const drawer = document.getElementById('terminalDrawer');
  const body = document.getElementById('terminalLogBody');
  const task = state.tasks.find(t => t.id === taskId);

  if (!drawer || !body) return;
  drawer.style.display = 'flex';
  body.innerHTML = '<div class="terminal-line system-line">[系统] 正在载入任务日志...</div>';

  if (task) {
    updateDrawerHeader(task);
  }

  // 从服务器拉取历史日志
  try {
    const res = await fetch(`/api/tasks/${taskId}/logs`).then(r => r.json());
    if (res.ok && res.data) {
      body.innerHTML = '';
      if (res.data.length === 0) {
        body.innerHTML = '<div class="terminal-line system-line">[系统] 该任务暂无控制台输出</div>';
      } else {
        res.data.forEach(log => appendLogToTerminal(log));
      }
    }
  } catch (err) {
    console.error('拉取日志失败:', err);
  }

  // 滚动到底部
  body.scrollTop = body.scrollHeight;
};

function updateDrawerHeader(task) {
  const badge = document.getElementById('terminalTaskStatus');
  const name = document.getElementById('terminalTaskName');
  const killBtn = document.getElementById('btnDrawerKillTask');

  if (badge) {
    badge.textContent = task.status === 'running' ? '运行中' : task.status;
    badge.className = `terminal-badge ${task.status}`;
  }
  if (name) {
    name.textContent = task.command;
  }
  if (killBtn) {
    killBtn.style.display = task.status === 'running' ? 'inline-flex' : 'none';
    killBtn.onclick = () => killTask(task.id);
  }
}

function appendLogToTerminal(log) {
  const body = document.getElementById('terminalLogBody');
  if (!body) return;

  const line = document.createElement('div');
  line.className = `terminal-line ${log.stream || 'stdout'}`;
  line.textContent = log.text;
  body.appendChild(line);

  // 自动滚动
  body.scrollTop = body.scrollHeight;
}

// 关闭/清空终端抽屉
document.getElementById('btnCloseTerminal')?.addEventListener('click', () => {
  const drawer = document.getElementById('terminalDrawer');
  if (drawer) drawer.style.display = 'none';
  state.activeTaskId = null;
});

document.getElementById('btnClearTerminal')?.addEventListener('click', () => {
  const body = document.getElementById('terminalLogBody');
  if (body) body.innerHTML = '<div class="terminal-line system-line">[系统] 终端屏幕已清空</div>';
});

// 终止任务
window.killTask = async function(taskId) {
  if (!confirm('确定要强行终止该任务进程吗？')) return;
  try {
    const res = await fetch(`/api/tasks/${taskId}/kill`, { method: 'POST' }).then(r => r.json());
    if (res.ok) {
      showToast('终止信号已发送');
    } else {
      showToast(res.error || '终止失败', 'error');
    }
  } catch (e) {
    showToast('网络请求异常', 'error');
  }
};

// 重新运行任务
window.restartTask = async function(taskId) {
  try {
    const res = await fetch(`/api/tasks/${taskId}/restart`, { method: 'POST' }).then(r => r.json());
    if (res.ok) {
      showToast('任务已重新开始运行', 'success');
      window.openTerminalDrawer(taskId);
    } else {
      showToast(res.error || '重试失败', 'error');
    }
  } catch (e) {
    showToast('请求异常', 'error');
  }
};

// 渲染通知中心
function renderNotifications() {
  const container = document.getElementById('notificationsListContainer');
  const quickCodeCard = document.getElementById('quickCodeCard');
  if (!container) return;

  let list = [...state.notifications];
  if (state.filterSource !== 'all') {
    list = list.filter(n => n.sourceType === state.filterSource);
  }

  // 检查最新未读短信验证码，若有则置顶快速提取卡片
  const latestCodeNotif = state.notifications.find(n => n.code && !n.read);
  if (latestCodeNotif && quickCodeCard) {
    quickCodeCard.style.display = 'block';
    document.getElementById('quickCodeDigits').textContent = latestCodeNotif.code;
    document.getElementById('quickCodeTime').textContent = formatTime(latestCodeNotif.timestamp);
    document.getElementById('quickCodeSender').textContent = `${latestCodeNotif.deviceName} - ${latestCodeNotif.title}`;
    document.getElementById('btnCopyQuickCode').onclick = () => {
      navigator.clipboard.writeText(latestCodeNotif.code);
      showToast(`验证码 ${latestCodeNotif.code} 已复制到剪贴板`, 'success');
    };
  } else if (quickCodeCard) {
    quickCodeCard.style.display = 'none';
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </div>
        <h3>暂无通知记录</h3>
        <p>手机端新通知、短信验证码或电脑任务结果将在此实时呈现</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => {
    const isUnread = !item.read;
    const sourceTypeMap = {
      sms: '短信验证',
      task: '任务状态',
      app: '应用消息',
      system: '系统通知'
    };

    return `
      <div class="notif-card ${isUnread ? 'unread' : ''}" data-notif-id="${item.id}">
        <div class="notif-card-top">
          <div class="notif-source-pill">
            <span>${escapeHtml(item.deviceName || '设备')}</span>
            <span>·</span>
            <span>${sourceTypeMap[item.sourceType] || '通知'}</span>
          </div>
          <span class="notif-time">${formatTime(item.timestamp)}</span>
        </div>

        <div class="notif-title">${escapeHtml(item.title)}</div>
        <div class="notif-content">${escapeHtml(item.content)}</div>

        ${item.code ? `
          <div class="notif-code-highlight" onclick="navigator.clipboard.writeText('${item.code}'); showToast('已复制验证码: ${item.code}', 'success');">
            <span>提取验证码: ${item.code}</span>
            <span style="font-size:0.75rem; text-decoration:underline; cursor:pointer;">[点击复制]</span>
          </div>
        ` : ''}

        <div class="notif-footer-actions">
          ${isUnread ? `
            <button class="btn btn-sm btn-ghost" onclick="markNotifRead('${item.id}')">标记已读</button>
          ` : ''}
          <button class="btn btn-sm btn-secondary" onclick="openReplyModal('${item.id}')">快捷回复</button>
          <button class="btn btn-sm btn-ghost" onclick="dismissNotif('${item.id}')">消除</button>
        </div>
      </div>
    `;
  }).join('');
}

// 过滤筛选
function setupFilters() {
  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      state.filterSource = btn.getAttribute('data-filter');
      renderNotifications();
    });
  });
}

// 标记单条通知已读
window.markNotifRead = async function(id) {
  await fetch(`/api/notifications/${id}/read`, { method: 'POST' });
  const n = state.notifications.find(item => item.id === id);
  if (n) n.read = true;
  renderNotifications();
  updateBadges();
};

// 消除通知
window.dismissNotif = async function(id) {
  await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
  state.notifications = state.notifications.filter(item => item.id !== id);
  renderNotifications();
  updateBadges();
};

// 快捷回复弹窗
window.openReplyModal = function(id) {
  const notif = state.notifications.find(item => item.id === id);
  if (!notif) return;
  state.activeReplyNotif = notif;

  const modal = document.getElementById('replyModal');
  const desc = document.getElementById('replyTargetDesc');
  const input = document.getElementById('replyTextInput');

  if (modal && desc && input) {
    desc.textContent = `回复来源: ${notif.deviceName} - "${notif.title}"`;
    input.value = '';
    modal.classList.add('show');
    input.focus();
  }
};

function setupReplyModal() {
  const modal = document.getElementById('replyModal');
  const closeBtn = document.getElementById('btnCloseReplyModal');
  const cancelBtn = document.getElementById('btnCancelReply');
  const submitBtn = document.getElementById('btnSubmitReply');

  const close = () => { modal?.classList.remove('show'); state.activeReplyNotif = null; };
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  submitBtn?.addEventListener('click', async () => {
    const text = document.getElementById('replyTextInput')?.value?.trim();
    if (!text) {
      showToast('请输入回复内容', 'error');
      return;
    }

    if (state.activeReplyNotif) {
      try {
        const res = await fetch(`/api/notifications/${state.activeReplyNotif.id}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionId: 'quick_reply', replyText: text })
        }).then(r => r.json());

        if (res.ok) {
          showToast(res.message || '回复已发出', 'success');
          close();
        } else {
          showToast(res.error || '发送失败', 'error');
        }
      } catch (e) {
        showToast('请求异常', 'error');
      }
    }
  });
}

// 下发新命令弹窗
function setupNewTaskModal() {
  const modal = document.getElementById('newTaskModal');
  const openBtn = document.getElementById('btnOpenNewTaskModal');
  const closeBtn = document.getElementById('btnCloseNewTaskModal');
  const cancelBtn = document.getElementById('btnCancelNewTask');
  const submitBtn = document.getElementById('btnSubmitNewTask');

  openBtn?.addEventListener('click', () => {
    modal?.classList.add('show');
    document.getElementById('newTaskCommand')?.focus();
  });

  const close = () => modal?.classList.remove('show');
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);

  // 快捷预设按钮点击
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.getAttribute('data-cmd');
      const textarea = document.getElementById('newTaskCommand');
      if (textarea && cmd) {
        textarea.value = cmd;
      }
    });
  });

  submitBtn?.addEventListener('click', async () => {
    const command = document.getElementById('newTaskCommand')?.value?.trim();
    const name = document.getElementById('newTaskName')?.value?.trim();

    if (!command) {
      showToast('命令行不能为空', 'error');
      return;
    }

    try {
      submitBtn.disabled = true;
      const res = await fetch('/api/tasks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, name })
      }).then(r => r.json());

      if (res.ok) {
        showToast(`已在电脑下发运行: ${res.data.name}`, 'success');
        close();
        document.getElementById('newTaskCommand').value = '';
        document.getElementById('newTaskName').value = '';
        window.openTerminalDrawer(res.data.id);
      } else {
        showToast(res.error || '启动失败', 'error');
      }
    } catch (e) {
      showToast('请求异常', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// 渲染网络与设备页面
function renderNetworkIps(ips) {
  const container = document.getElementById('networkIpList');
  if (!container) return;

  if (ips.length === 0) {
    container.innerHTML = `
      <div class="ip-item">
        <span class="ip-type">本地回路</span>
        <span class="ip-addr">http://localhost:7788</span>
      </div>
    `;
    return;
  }

  container.innerHTML = ips.map(item => `
    <div class="ip-item">
      <span class="ip-type">${escapeHtml(item.type)}</span>
      <span class="ip-addr" id="ip_${escapeHtml(item.address)}">http://${item.address}:7788</span>
      <button class="btn btn-sm btn-secondary" onclick="navigator.clipboard.writeText('http://${item.address}:7788'); showToast('地址已复制到剪贴板');">复制</button>
    </div>
  `).join('');

  // 自动绘制第一个可外部访问 IP 的二维码
  renderQrCode(ips[0]?.address);
}

function renderQrCode(specifiedIp) {
  const canvas = document.getElementById('qrCanvas');
  if (!canvas || typeof QRCode === 'undefined') return;

  // 优先取当前页面 host，或传入的 IP
  let targetUrl = window.location.href;
  if (specifiedIp && window.location.hostname === 'localhost') {
    targetUrl = `http://${specifiedIp}:7788`;
  }

  QRCode.toCanvas(canvas, targetUrl, {
    width: 170,
    margin: 1,
    color: { dark: '#0a0d14', light: '#ffffff' }
  }, (err) => {
    if (err) console.warn('二维码生成失败:', err);
  });
}

function renderConnectedDevices() {
  const container = document.getElementById('connectedDeviceList');
  const countBadge = document.getElementById('onlineDeviceCount');
  if (!container) return;

  if (countBadge) {
    countBadge.textContent = `${state.devices.length} 台`;
  }

  if (state.devices.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:16px;">暂无其他在线设备</div>`;
    return;
  }

  container.innerHTML = state.devices.map(dev => `
    <div class="device-item">
      <div class="device-info-left">
        <span class="status-dot connected"></span>
        <div>
          <div class="device-name">${escapeHtml(dev.name)}</div>
          <div class="device-sub">${escapeHtml(dev.clientType)} · ${dev.ip || '局域网'}</div>
        </div>
      </div>
      <span class="task-time">${formatTime(dev.connectedAt)}</span>
    </div>
  `).join('');
}

// 刷新导航角标
function updateBadges() {
  const runningCount = state.tasks.filter(t => t.status === 'running').length;
  const unreadCount = state.notifications.filter(n => !n.read).length;

  const taskBadge = document.getElementById('runningTaskBadge');
  const notifBadge = document.getElementById('unreadNotifBadge');

  if (taskBadge) taskBadge.textContent = runningCount;
  if (notifBadge) notifBadge.textContent = unreadCount;
}

// HTML 简单转义防止 XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
