const { spawn } = require('child_process');
const EventEmitter = require('events');

class TaskManager extends EventEmitter {
  constructor(notificationStore) {
    super();
    this.notificationStore = notificationStore;
    this.tasks = new Map(); // taskId -> TaskObject
  }

  createTask({ command, name, cwd = process.cwd(), tags = [] }) {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const task = {
      id,
      name: name || command.slice(0, 40),
      command,
      cwd,
      tags,
      status: 'pending', // 'pending' | 'running' | 'completed' | 'failed' | 'terminated'
      exitCode: null,
      startTime: null,
      endTime: null,
      durationMs: 0,
      logs: [], // 最近日志条目 { time, text, stream: 'stdout'|'stderr' }
      maxLogs: 1000,
      process: null
    };

    this.tasks.set(id, task);
    this.emit('task:created', this.serializeTask(task));
    return task;
  }

  runTask(taskOrOptions) {
    let task;
    if (typeof taskOrOptions === 'string') {
      task = this.tasks.get(taskOrOptions);
    } else if (taskOrOptions.id && this.tasks.has(taskOrOptions.id)) {
      task = this.tasks.get(taskOrOptions.id);
    } else {
      task = this.createTask(taskOrOptions);
    }

    if (!task) {
      throw new Error('未找到指定任务');
    }

    if (task.status === 'running') {
      throw new Error('任务已在运行中');
    }

    task.status = 'running';
    task.startTime = Date.now();
    task.endTime = null;
    task.exitCode = null;
    task.logs = [];

    this.appendLog(task, 'stdout', `[系统] 任务已启动: ${task.command}`);
    this.emit('task:status', this.serializeTask(task));

    try {
      // 在 Windows 下使用 shell 启动子进程
      const isWin = process.platform === 'win32';
      const shell = isWin ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
      const shellArgs = isWin ? ['/d', '/s', '/c', task.command] : ['-c', task.command];

      const child = spawn(shell, shellArgs, {
        cwd: task.cwd,
        env: { ...process.env, PYTHONUNBUFFERED: '1', FORCE_COLOR: '0' },
        windowsVerbatimArguments: true
      });

      task.process = child;

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        this.appendLog(task, 'stdout', text);
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        this.appendLog(task, 'stderr', text);
      });

      child.on('error', (err) => {
        this.appendLog(task, 'stderr', `[系统错误] 进程发生错误: ${err.message}`);
        this.finishTask(task, 'failed', -1);
      });

      child.on('close', (code) => {
        const finalStatus = code === 0 ? 'completed' : (task.status === 'terminated' ? 'terminated' : 'failed');
        this.finishTask(task, finalStatus, code);
      });

    } catch (err) {
      this.appendLog(task, 'stderr', `[启动异常] ${err.message}`);
      this.finishTask(task, 'failed', -1);
    }

    return task;
  }

  appendLog(task, stream, text) {
    // 拆分换行
    const lines = text.split(/\r?\n/);
    const now = Date.now();
    for (const line of lines) {
      if (line.length === 0) continue;
      const logItem = { time: now, stream, text: line };
      task.logs.push(logItem);
      if (task.logs.length > task.maxLogs) {
        task.logs.shift();
      }
      this.emit('task:log', { taskId: task.id, ...logItem });
    }
  }

  finishTask(task, status, exitCode) {
    task.status = status;
    task.exitCode = exitCode;
    task.endTime = Date.now();
    task.durationMs = task.endTime - (task.startTime || task.endTime);
    task.process = null;

    const durationSec = (task.durationMs / 1000).toFixed(1);
    const summary = status === 'completed'
      ? `执行成功，耗时 ${durationSec} 秒`
      : status === 'terminated'
        ? `任务被手动终止，耗时 ${durationSec} 秒`
        : `执行失败 (退出代码: ${exitCode})，耗时 ${durationSec} 秒`;

    this.appendLog(task, 'stdout', `[系统] ${summary}`);
    this.emit('task:status', this.serializeTask(task));

    // 自动在通知中心创建一条通知
    if (this.notificationStore) {
      const level = status === 'completed' ? 'success' : 'error';
      this.notificationStore.add({
        deviceId: 'local-pc',
        deviceName: '电脑工作台',
        sourceType: 'task',
        title: `任务[${task.name}] ${status === 'completed' ? '运行完成' : '运行异常'}`,
        content: `${task.command}\n${summary}`,
        level,
        actions: [
          { id: `restart_${task.id}`, label: '重新运行', type: 'restart_task', taskId: task.id }
        ]
      });
    }
  }

  killTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === 'running' && task.process) {
      task.status = 'terminated';
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', task.process.pid.toString(), '/f', '/t']);
        } else {
          task.process.kill('SIGTERM');
        }
      } catch (err) {
        console.error('终止进程失败:', err.message);
      }
      return true;
    }
    return false;
  }

  restartTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    if (task.status === 'running') {
      this.killTask(taskId);
    }
    return this.runTask(task);
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  getAllTasks() {
    return Array.from(this.tasks.values())
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
      .map(t => this.serializeTask(t));
  }

  serializeTask(task) {
    return {
      id: task.id,
      name: task.name,
      command: task.command,
      cwd: task.cwd,
      tags: task.tags,
      status: task.status,
      exitCode: task.exitCode,
      startTime: task.startTime,
      endTime: task.endTime,
      durationMs: task.durationMs || (task.startTime ? Date.now() - task.startTime : 0),
      logCount: task.logs.length
    };
  }
}

module.exports = TaskManager;
