const { app, BrowserWindow, Menu, Tray, shell, ipcMain, nativeTheme, protocol, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { registerContentManager } = require('./content-manager');
const { registerAcToolsBridge } = require('./actools-bridge');

let mainWindow;
let tray = null;
let activeSteamLogin = null;
let acToolsBridge = null;

function steamOpenIdUrl(returnUrl) {
  const realm = new URL(returnUrl).origin;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });
  return `https://steamcommunity.com/openid/login?${params}`;
}

function beginDesktopSteamLogin(state) {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(String(state || ''))) throw new Error('Desafio de autenticação inválido.');
  activeSteamLogin?.cancel();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, callbackUrl) => {
      if (settled) return;
      settled = true; clearTimeout(timer); if (server.listening) server.close(); activeSteamLogin = null;
      error ? reject(error) : resolve(callbackUrl);
    };
    const server = http.createServer((request, response) => {
      const callback = new URL(request.url, `http://127.0.0.1:${server.address().port}`);
      if (request.method !== 'GET' || callback.pathname !== '/steam/callback' || callback.searchParams.get('state') !== state) {
        response.writeHead(400, { 'Content-Type':'text/plain; charset=utf-8', 'Cache-Control':'no-store' });
        response.end('Retorno de autenticação inválido.');
        return;
      }
      response.writeHead(200, {
        'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
      });
      response.end('<!doctype html><meta charset="utf-8"><title>BSR Hub</title><style>body{font:16px Segoe UI;background:#080c11;color:#eef5f0;display:grid;place-items:center;height:100vh;margin:0}main{text-align:center}b{color:#4bb957}</style><main><h1><b>BSR Hub</b></h1><p>Identidade recebida. Você já pode fechar esta janela.</p></main>');
      finish(null, callback.href);
    });
    const timer = setTimeout(() => finish(new Error('A autenticação Steam expirou. Tente novamente.')), 3 * 60 * 1000);
    activeSteamLogin = { cancel: () => finish(new Error('Uma nova autenticação foi iniciada.')) };
    server.on('error', error => finish(error));
    server.listen(0, '127.0.0.1', async () => {
      const returnUrl = `http://127.0.0.1:${server.address().port}/steam/callback?state=${encodeURIComponent(state)}`;
      try { await shell.openExternal(steamOpenIdUrl(returnUrl)); }
      catch (error) { finish(error); }
    });
  });
}

// Registra protocolo personalizado
protocol.registerSchemesAsPrivileged([
  { scheme: 'bsr', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false, // <-- IMPORTANTE: desativa a barra padrão do sistema
    transparent: false,
    backgroundColor: '#080808',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // <-- CARREGA O PRELOAD
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets/foto/favicon.png'),
    show: false,
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Abre links externos no navegador
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // DevTools com Ctrl+Shift+I
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key === 'I') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Menu personalizado
  const menuTemplate = [
    {
      label: 'BSR',
      submenu: [
        { label: 'Sobre', click: () => shell.openExternal('https://bsrracing2.netlify.app/sobre.html') },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' }
      ]
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Site oficial', click: () => shell.openExternal('https://bsrracing2.netlify.app') },
        { label: 'Discord', click: () => shell.openExternal('https://discord.gg/v9B8RKAj4Y') },
        { label: 'Reportar problema', click: () => shell.openExternal('https://bsrracing2.netlify.app/contato.html') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  createTray();

  mainWindow.on('close', (event) => {
    // Se quiser fechar realmente, remova o preventDefault
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/foto/favicon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Mostrar BSR', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Sair', click: () => app.quit() }
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('BSR Racing Hub');
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── IPC PARA CONTROLE DA JANELA ──
ipcMain.on('window-control', (event, action) => {
  switch (action) {
    case 'minimize':
      mainWindow.minimize();
      break;
    case 'maximize':
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      break;
    case 'close':
      mainWindow.close();
      break;
  }
});

// ── TEMA ──
ipcMain.handle('get-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('start-steam-login', (event, state) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Origem de autenticação inválida.');
  return beginDesktopSteamLogin(state);
});

// ── NOTIFICAÇÕES ──
ipcMain.on('notify', (event, title, body) => {
  console.log(`[Notificação] ${title}: ${body}`);
});

// ============================================================
// REGISTRA O PROTOCOLO PERSONALIZADO PARA ARQUIVOS LOCAIS
// ============================================================
app.whenReady().then(() => {
  app.setAppUserModelId('com.bsr.racing');
  protocol.handle('bsr', (request) => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
    const filePath = path.resolve(__dirname, relativePath);
    const appRoot = path.resolve(__dirname) + path.sep;
    if (!filePath.startsWith(appRoot)) {
      return new Response('Caminho inválido', { status: 403 });
    }
    if (!fs.existsSync(filePath)) {
      console.warn('[main] Arquivo não encontrado:', filePath);
      return new Response('Arquivo não encontrado', { status: 404 });
    }
    return net.fetch('file://' + filePath);
  });

  createWindow();
  acToolsBridge = registerAcToolsBridge({ app });
  registerContentManager({ app, dialog, net, BrowserWindow, ipcMain, getMainWindow:() => mainWindow, actools:acToolsBridge });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => { acToolsBridge?.close().catch(() => {}); });
