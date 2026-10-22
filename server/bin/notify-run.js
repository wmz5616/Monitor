#!/usr/bin/env node
const http = require('http');
const { WebSocket } = require('ws');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('用法: notify-run <要运行的命令>');
  console.log('示例: notify-run python train.py');
  console.log('示例: notify-run npm run build');
  process.exit(0);
}

const command = args.join(' ');
const PORT = process.env.PORT || 7788;
const cwd = process.cwd();

console.log(`[准备启动监控任务] 命令: "${command}"`);
console.log(`[工作目录] ${cwd}`);

const payload = JSON.stringify({
  command,
  cwd,
  name: command.slice(0, 35)
});

const req = http.request({
  hostname: '127.0.0.1',
  port: PORT,
  path: '/api/tasks/run',
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
      if (!json.ok) {
        console.error(`[执行失败] ${json.error}`);
        process.exit(1);
      }

      const task = json.data;
      console.log(`[任务已接入监控] 任务 ID: ${task.id}`);
      console.log(`[提示] 你现在可以打开手机查看实时日志，代码跑完手机会自动弹出提醒。`);
      console.log('---------------- 实时输出开始 ----------------');

      // 建立 WebSocket 监听该任务输出并打印到当前终端
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', name: 'CLI-Runner', clientType: 'cli' }));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.event === 'task:log' && msg.data.taskId === task.id) {
            if (msg.data.stream === 'stderr') {
              process.stderr.write(`\x1b[31m${msg.data.text}\x1b[0m\n`);
            } else {
              process.stdout.write(`${msg.data.text}\n`);
            }
          }
          if (msg.event === 'task:status' && msg.data.id === task.id) {
            if (msg.data.status !== 'running') {
              console.log('---------------- 任务执行结束 ----------------');
              console.log(`[状态] ${msg.data.status} (耗时: ${(msg.data.durationMs / 1000).toFixed(1)}s, 退出码: ${msg.data.exitCode})`);
              ws.close();
              process.exit(msg.data.exitCode === 0 ? 0 : 1);
            }
          }
        } catch (e) {}
      });

      ws.on('error', (err) => {
        // ws 出错不中断程序
      });

    } catch (e) {
      console.error('[响应解析错误]', responseData);
    }
  });
});

req.on('error', (err) => {
  console.error(`[无法连接到服务] 请确认通知共享服务已启动 (端口 ${PORT}):`, err.message);
  process.exit(1);
});

req.write(payload);
req.end();
