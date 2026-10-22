const os = require('os');

class DeviceManager {
  constructor() {
    this.devices = new Map(); // socket/clientId -> DeviceInfo
  }

  // 获取本机的所有网络 IP 地址（包括局域网 IP 和 Tailscale 虚拟网卡 IP）
  getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        // 只筛选 IPv4 并且不是 127.0.0.1
        if (addr.family === 'IPv4' && !addr.internal) {
          const isTailscale = name.toLowerCase().includes('tailscale') || addr.address.startsWith('100.');
          addresses.push({
            name,
            address: addr.address,
            type: isTailscale ? 'Tailscale虚拟内网 (支持跨公网/随时随地)' : '局域网Wi-Fi (同Wi-Fi直连)'
          });
        }
      }
    }

    return addresses;
  }

  registerDevice(clientId, info) {
    const device = {
      id: clientId,
      name: info.name || '未知设备',
      clientType: info.clientType || 'web', // 'web-mobile' | 'web-pc' | 'android-app'
      userAgent: info.userAgent || '',
      ip: info.ip || '',
      connectedAt: Date.now(),
      lastSeen: Date.now()
    };
    this.devices.set(clientId, device);
    return device;
  }

  updateActivity(clientId) {
    const device = this.devices.get(clientId);
    if (device) {
      device.lastSeen = Date.now();
    }
  }

  unregisterDevice(clientId) {
    const dev = this.devices.get(clientId);
    this.devices.delete(clientId);
    return dev;
  }

  getConnectedDevices() {
    return Array.from(this.devices.values());
  }
}

module.exports = DeviceManager;
