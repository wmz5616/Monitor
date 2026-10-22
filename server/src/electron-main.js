const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow = null;
let tray = null;
const PORT = process.env.PORT || 7788;

function checkServerRunning(callback) {
  const req = http.get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
    callback(res.statusCode === 200);
  });
  req.on('error', () => callback(false));
  req.setTimeout(600, () => {
    req.destroy();
    callback(false);
  });
}

function startBackgroundServer() {
  try {
    require('./index.js');
    console.log('[桌面端] 内置后台 Hub 服务已随应用启动');
  } catch (err) {
    console.error('[桌面端] 启动内置服务失败:', err.message);
  }
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    title: 'LinkNotify 多端通知与代码协同',
    backgroundColor: '#0a0d14',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const targetUrl = `http://localhost:${PORT}`;
  mainWindow.loadURL(targetUrl).catch(() => {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
  });

  mainWindow.show();
  mainWindow.focus();

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function setupTray() {
  try {
    const icon = nativeImage.createFromBuffer(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZElEQVQ4T2NkoBAwUqifYdQADBgG' +
        'hBswMDD8Z2BgcABiZhiNh2kGBgZGBkZGdiBmAmIGBiSZ0TSxY1E1Y8c4NWM1gIWRkXEDiH0YGB' +
        'j+Awk2IMwAZIMwC1F1Y2ji2EGEkQEbAABQ3hY9j92d1AAAAABJRU5ErkJggg==',
        'base64'
      )
    );

    tray = new Tray(icon);
    tray.setToolTip('LinkNotify 多端通知协同 (后台运行中)');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '打开工作台界面',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出程序',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });
  } catch (err) {
    console.warn('[托盘初始化忽略]', err.message);
  }
}

// 阻止窗口全部关闭时退出程序
app.on('window-all-closed', () => {
  // 保持后台和托盘运行
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    setupTray();

    checkServerRunning((isRunning) => {
      if (!isRunning) {
        startBackgroundServer();
        // 重新刷新主窗口以连接已启动的服务
        setTimeout(() => {
          if (mainWindow) mainWindow.loadURL(`http://localhost:${PORT}`);
        }, 1000);
      }
    });
  });
}

app.on('before-quit', () => {
  app.isQuitting = true;
});
