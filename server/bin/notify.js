#!/usr/bin/env node
const http = require('http');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('用法: notify <标题> [内容] [级别:info|success|warn|error]');
  console.log('示例: notify "构建完成" "前端构建用时15秒" success');
  process.exit(0);
}

const title = args[0] || '通知';
const content = args[1] || '';
const level = args[2] || 'info';

const payload = JSON.stringify({
  title,
  content,
  level,
  sourceType: 'task',
  deviceName: '本地命令行 (CLI)',
  deviceId: 'cli-' + process.pid
});

const req = http.request({
  hostname: '127.0.0.1',
  port: process.env.PORT || 7788,
  path: '/api/notifications',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, (res) => {
  let responseData = '';
  res.on('data', chunk => { responseData += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(responseData);
      if (json.ok) {
        console.log(`[成功] 通知已发送: "${title}" -> 已推送到所有关联设备`);
      } else {
        console.error(`[失败] ${json.error || '服务器拒绝'}`);
      }
    } catch (e) {
      console.log(`[响应] ${responseData}`);
    }
  });
});

req.on('error', (err) => {
  console.error(`[无法连接到服务] 请确认通知共享服务已启动 (端口 ${process.env.PORT || 7788}):`, err.message);
});

req.write(payload);
req.end();
