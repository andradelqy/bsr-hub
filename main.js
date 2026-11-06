const { app, BrowserWindow, Menu, Tray, shell, ipcMain, nativeTheme, protocol, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { registerContentManager, APP_ID } = require('./content-manager');
const { registerAcToolsBridge } = require('./actools-bridge');
const { BsrTelemetryUploader } = require('./telemetry/uploader');

let mainWindow;
let tray = null;
let activeSteamLogin = null;
let acToolsBridge = null;
let telemetryUploader = null;
let contentManager = null;

function loadBack4AppClientKey() {
  const configPath = path.join(__dirname, 'config.js');
  const source = fs.readFileSync(configPath, 'utf8');
  const match = source.match(/window\.CLIENT_KEY\s*=\s*['"]([^'"]+)['"]/);
  if (!match || !match[1] || /^YOUR_|^PREENCHER/i.test(match[1])) {
    throw new Error('A Client Key do Back4App não foi configurada em config.js. Gere/ative uma Client Key em App Settings > Security & Keys.');
  }
  return match[1];
}

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

const TELEMETRY_CONSENT_VERSION = 1;

async function ensureTelemetryConsent() {
  const consentPath = path.join(app.getPath('userData'), 'bsr-telemetry-consent.json');
  try {
    const saved = JSON.parse(await fs.promises.readFile(consentPath, 'utf8'));
    if (saved.accepted === true && saved.policyVersion === TELEMETRY_CONSENT_VERSION) return true;
  } catch (_) {}

  const result = await dialog.showMessageBox({
    type:'warning',
    title:'Autorização obrigatória — BSR Race Telemetry',
    message:'Para utilizar o BSR Racing Hub, é necessário autorizar a recolha automática de telemetria e replays.',
    detail:[
      'O BSR fará automaticamente as seguintes alterações neste computador:',
      '• instalar a app Python BSR Race Telemetry na pasta apps/python do Assetto Corsa;',
      '• ativar a app Python e o salvamento automático de replays, com buffer de até 2.000 MB e retenção de quatro corridas;',
      '• criar cópias de segurança dos arquivos de configuração antes de os alterar;',
      '• recolher velocidade, aceleração, estado do carro, danos e candidatos a incidentes durante as sessões iniciadas pelo BSR;',
      '• enviar a telemetria e os replays por HTTPS para o armazenamento BSR/Back4App, associados à conta Steam autenticada.',
      '',
      'Não será aberta nenhuma porta de entrada, nem alterados o firewall ou o router. A comunicação usa apenas ligações HTTPS de saída.',
      'Os arquivos enviados para Back4App usam URLs diretas não listadas; qualquer pessoa que obtenha o URL de um arquivo poderá aceder a esse arquivo. Não partilhe esses links.',
      '',
      'O Windows poderá apresentar uma solicitação de administrador (UAC) se a instalação do Assetto Corsa estiver numa pasta protegida. Se cancelar essa autorização, o BSR será encerrado e não poderá ser utilizado.'
    ].join('\n'),
    buttons:['Autorizar e continuar','Não autorizo — sair'],
    defaultId:0,
    cancelId:1,
    noLink:true
  });
  if (result.response !== 0) return false;

  await fs.promises.mkdir(path.dirname(consentPath), { recursive:true });
  const payload = { accepted:true, policyVersion:TELEMETRY_CONSENT_VERSION, acceptedAt:new Date().toISOString() };
  const temporary = consentPath + '.tmp';
  await fs.promises.writeFile(temporary, JSON.stringify(payload, null, 2), 'utf8');
  await fs.promises.copyFile(temporary, consentPath);
  await fs.promises.unlink(temporary).catch(() => {});
  return true;
}

function assertTrustedMainWindow(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Origem não autorizada.');
}

async function closeLauncherForTelemetryFailure(error) {
  const message = error && error.code === 'BSR_ELEVATION_DENIED'
    ? 'A autorização do Windows foi recusada. O BSR Race Telemetry não foi instalado e o launcher será encerrado.'
    : 'Não foi possível instalar ou configurar o BSR Race Telemetry: ' + String((error && error.message) || error);
  await dialog.showMessageBox({ type:'error', title:'BSR Race Telemetry obrigatório', message, buttons:['Sair'] }).catch(() => {});
  app.quit();
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.bsr.racing');
  const accepted = await ensureTelemetryConsent();
  if (!accepted) {
    app.quit();
    return;
  }

  protocol.handle('bsr', (request) => {
    const url = new URL(request.url);
    const relativePath = decodeURIComponent(url.pathname).replace(/^[/\\\\]+/, '');
    const filePath = path.resolve(__dirname, relativePath);
    const appRoot = path.resolve(__dirname) + path.sep;
    if (!filePath.startsWith(appRoot)) return new Response('Caminho inválido', { status:403 });
    if (!fs.existsSync(filePath)) {
      console.warn('[main] Arquivo não encontrado:', filePath);
      return new Response('Arquivo não encontrado', { status:404 });
    }
    return net.fetch('file://' + filePath);
  });

  acToolsBridge = registerAcToolsBridge({ app });
  telemetryUploader = new BsrTelemetryUploader({
    appId:APP_ID,
    clientKey:loadBack4AppClientKey(),
    documentsDir:app.getPath('documents'),
    userData:app.getPath('userData'),
    onStatus:status => {
      console.log('[BSR Telemetry]', status.type, status.kind || '', status.file || status.message || '');
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('telemetry:status', status);
    }
  });
  await telemetryUploader.initialize();
  ipcMain.handle('telemetry:set-session', (event, token) => {
    assertTrustedMainWindow(event);
    return telemetryUploader.setSessionToken(typeof token === 'string' ? token : '');
  });

  ipcMain.handle('telemetry:download-report-replay', async (event, manifest, originalName) => {
    assertTrustedMainWindow(event);
    if (!Array.isArray(manifest) || manifest.length < 1 || manifest.length > 1000) {
      throw new Error('Manifesto de replay inválido.');
    }
    const ordered = [...manifest].sort((a,b) => Number(a.index) - Number(b.index));
    let totalBytes = 0;
    for (let index = 0; index < ordered.length; index += 1) {
      const chunk = ordered[index];
      const url = new URL(String(chunk.url || ''));
      if (url.protocol !== 'https:' || url.hostname !== 'parsefiles.back4app.com') {
        throw new Error('O manifesto contém um endereço de evidência não autorizado.');
      }
      if (Number(chunk.index) !== index || !/^[a-f0-9]{64}$/i.test(String(chunk.sha256 || ''))) {
        throw new Error('O manifesto possui blocos fora de ordem ou hash inválido.');
      }
      const bytes = Number(chunk.bytes);
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 8 * 1024 * 1024) throw new Error('Tamanho de bloco inválido.');
      totalBytes += bytes;
    }
    if (totalBytes > 2 * 1024 * 1024 * 1024) throw new Error('O replay excede o limite de 2 GB.');

    const safeBase = path.basename(String(originalName || 'BSR-Replay.acreplay'))
      .replace(/[<>:"/\\\\|?*\\x00-\\x1F]/g, '_').slice(0, 120);
    const replayName = safeBase.toLowerCase().endsWith('.acreplay') ? safeBase : safeBase + '.acreplay';
    const outputDir = path.join(app.getPath('downloads'), 'BSR Evidence');
    await fs.promises.mkdir(outputDir, { recursive:true });
    const outputPath = path.join(outputDir, Date.now() + '_' + replayName);
    const handle = await fs.promises.open(outputPath, 'wx');
    try {
      let position = 0;
      for (const chunk of ordered) {
        const response = await net.fetch(chunk.url);
        if (!response.ok) throw new Error('Falha ao descarregar um bloco do replay (HTTP ' + response.status + ').');
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length !== Number(chunk.bytes)) throw new Error('O tamanho de um bloco não corresponde ao manifesto.');
        const digest = crypto.createHash('sha256').update(buffer).digest('hex');
        if (digest !== String(chunk.sha256).toLowerCase()) throw new Error('A verificação SHA-256 de um bloco falhou.');
        await handle.write(buffer, 0, buffer.length, position);
        position += buffer.length;
      }
      if (position !== totalBytes) throw new Error('O replay reconstruído possui tamanho inesperado.');
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
      throw error;
    }
    await handle.close();
    shell.showItemInFolder(outputPath);
    return { path:outputPath, bytes:totalBytes };
  });

  contentManager = registerContentManager({
    app, dialog, net, BrowserWindow, ipcMain,
    getMainWindow:() => mainWindow,
    actools:acToolsBridge,
    telemetryConsent:true
  });
  try {
    await contentManager.initialize();
  } catch (error) {
    await closeLauncherForTelemetryFailure(error);
    return;
  }

  createWindow();
}).catch(async error => {
  await closeLauncherForTelemetryFailure(error);
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  acToolsBridge?.close().catch(() => {});
  telemetryUploader?.close();
});
