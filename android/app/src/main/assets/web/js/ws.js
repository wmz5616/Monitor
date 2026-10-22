class RealtimeClient {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.retryCount = 0;
    this.isConnected = false;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.retryCount = 0;
        this.emit('connection_change', { status: 'connected' });

        // 发送设备注册消息
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const deviceName = isMobile ? '随身移动端 (手机/平板)' : '桌面工作台浏览器';
        const clientType = isMobile ? 'web-mobile' : 'web-pc';

        this.send({
          type: 'register',
          name: deviceName,
          clientType
        });

        // 启动心跳
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.send({ type: 'ping' });
          }
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.event) {
            this.emit(payload.event, payload.data);
          }
        } catch (err) {
          console.error('[WS] 无法解析收到数据:', err);
        }
      };

      this.ws.onclose = () => {
        this.cleanup();
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[WS] 连接异常:', err);
        this.ws.close();
      };

    } catch (err) {
      console.error('[WS] 实例化异常:', err);
      this.scheduleReconnect();
    }
  }

  cleanup() {
    this.isConnected = false;
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.emit('connection_change', { status: 'disconnected' });
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.retryCount++;
    const delay = Math.min(1000 * Math.pow(1.5, this.retryCount), 10000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  emit(event, data) {
    const list = this.handlers.get(event) || [];
    for (const fn of list) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[WS] 触发事件 ${event} 处理函数异常:`, err);
      }
    }
  }
}

window.realtimeClient = new RealtimeClient();
