const fs = require('fs');
const path = require('path');

class NotificationStore {
  constructor(storageFile = null) {
    this.storageFile = storageFile || path.join(__dirname, '..', 'data', 'notifications.json');
    this.notifications = [];
    this.ensureStorage();
    this.load();
  }

  ensureStorage() {
    const dir = path.dirname(this.storageFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf8');
        this.notifications = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[NotificationStore] 加载历史通知失败, 初始化为空:', err.message);
      this.notifications = [];
    }
  }

  save() {
    try {
      // 保持最近 200 条，避免无限增长
      if (this.notifications.length > 200) {
        this.notifications = this.notifications.slice(0, 200);
      }
      fs.writeFileSync(this.storageFile, JSON.stringify(this.notifications, null, 2), 'utf8');
    } catch (err) {
      console.error('[NotificationStore] 保存通知失败:', err.message);
    }
  }

  // 智能提取短信/文本中的验证码
  extractVerificationCode(text) {
    if (!text || typeof text !== 'string') return null;
    
    // 匹配如: 验证码123456、code: 889900、动态码是 4321 等
    const patterns = [
      /(?:验证码|校验码|动态码|确认码|激活码|安全码|动态密码|code|verification\s*code)[^\d]{0,8}([0-9]{4,8})/i,
      /([0-9]{4,8})[^\d]{0,6}(?:为您的验证码|是您的验证码|是本次验证码|有效)/i,
      /\b([0-9]{6})\b/ // 独立的6位纯数字通常是验证码
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    return null;
  }

  add(data) {
    const id = data.id || `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fullContent = `${data.title || ''} ${data.content || ''}`;
    const code = data.code || this.extractVerificationCode(fullContent);

    const item = {
      id,
      deviceId: data.deviceId || 'local-pc',
      deviceName: data.deviceName || '本地设备',
      sourceType: data.sourceType || 'system', // 'sms' | 'task' | 'app' | 'system'
      packageName: data.packageName || '',
      title: data.title || '无标题',
      content: data.content || '',
      code: code || null,
      level: data.level || 'info', // 'info' | 'success' | 'warn' | 'error'
      timestamp: data.timestamp || Date.now(),
      read: false,
      actions: Array.isArray(data.actions) ? data.actions : []
    };

    // 插入到最前
    this.notifications.unshift(item);
    this.save();
    return item;
  }

  list(filter = {}) {
    let result = [...this.notifications];
    if (filter.sourceType) {
      result = result.filter(n => n.sourceType === filter.sourceType);
    }
    if (filter.unreadOnly) {
      result = result.filter(n => !n.read);
    }
    return result;
  }

  get(id) {
    return this.notifications.find(n => n.id === id) || null;
  }

  markRead(id) {
    const item = this.get(id);
    if (item) {
      item.read = true;
      this.save();
      return true;
    }
    return false;
  }

  markAllRead() {
    this.notifications.forEach(n => { n.read = true; });
    this.save();
    return true;
  }

  dismiss(id) {
    const idx = this.notifications.findIndex(n => n.id === id);
    if (idx !== -1) {
      const removed = this.notifications.splice(idx, 1)[0];
      this.save();
      return removed;
    }
    return null;
  }

  clear() {
    this.notifications = [];
    this.save();
  }
}

module.exports = NotificationStore;
