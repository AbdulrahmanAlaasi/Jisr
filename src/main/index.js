'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  nativeTheme,
  powerMonitor,
  safeStorage,
  shell,
  Tray,
} = require('electron');
const QRCode = require('qrcode');
const { JisrStore } = require('./store');
const { DeviceDiscovery } = require('./discovery');
const { migrateLegacyPreferences } = require('./migration');
const { TransferService } = require('./transfer-service');
const { UpdateService } = require('./update-service');

const APP_NAME = 'Jisr';
const MAX_SELECTED_PATHS = 2_000;

let mainWindow = null;
let tray = null;
let quitting = false;
let store = null;
let discovery = null;
let transfers = null;
let updateService = null;
let lastNotifiedUpdate = null;
let migrationState = { migrated: false };

const appIcon = nativeImage.createFromPath(
  path.join(__dirname, '../renderer/assets/jisr-icon.png'),
);

app.setName(APP_NAME);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(initialize).catch((error) => {
    dialog.showErrorBox(`${APP_NAME} could not start`, error.stack || error.message);
    app.quit();
  });
}

async function initialize() {
  nativeTheme.themeSource = 'light';
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  const userDataPath = app.getPath('userData');
  migrationState = await migrateLegacyPreferences({
    legacyDirectory: path.join(app.getPath('appData'), 'OrbitSend'),
    targetDirectory: userDataPath,
    downloadsPath: app.getPath('downloads'),
  });
  store = await new JisrStore(
    userDataPath,
    safeStorage,
    app.getPath('downloads'),
  ).init();

  updateService = new UpdateService({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isEnabled: () => Boolean(store.settings.checkForUpdates),
  });

  let serviceRef = null;
  discovery = new DeviceDiscovery(
    () => serviceRef?.publicIdentity(),
    () => Boolean(store.settings.receivingEnabled),
  );
  transfers = new TransferService(store, discovery);
  serviceRef = transfers;
  await transfers.start();
  discovery.start();

  registerIpc();
  wireEvents();
  createWindow();
  createTray();
  applyLoginSetting();

  const initialUpdateTimer = setTimeout(() => updateService.check().catch(() => {}), 3_000);
  initialUpdateTimer.unref?.();
  const updateInterval = setInterval(() => updateService.check().catch(() => {}), 6 * 60 * 60 * 1000);
  updateInterval.unref?.();

  powerMonitor.on('resume', () => discovery.announce());
  app.on('activate', () => showWindow());
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    discovery?.stop();
    transfers?.stop().catch(() => {});
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    show: false,
    backgroundColor: '#f4f5f9',
    icon: appIcon,
    title: APP_NAME,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!quitting && store.settings.keepRunningInTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(appIcon.resize({ width: 20, height: 20 }));
  tray.setToolTip(APP_NAME);
  refreshTrayMenu();
  tray.on('click', showWindow);
}

function refreshTrayMenu() {
  if (!tray) return;
  const nearby = combinedDevices().filter((device) => device.online && device.paired);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Jisr', click: showWindow },
    { type: 'separator' },
    nearby.length
      ? { label: `${nearby.length} paired device${nearby.length === 1 ? '' : 's'} nearby`, enabled: false }
      : { label: 'No paired devices nearby', enabled: false },
    {
      label: store.settings.receivingEnabled ? 'Pause receiving' : 'Resume receiving',
      click: async () => {
        await store.updateSettings({ receivingEnabled: !store.settings.receivingEnabled });
        discovery.announce();
        broadcastState();
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    { label: 'Quit Jisr', click: () => { quitting = true; app.quit(); } },
  ]));
}

function wireEvents() {
  updateService.on('state', (updateState) => {
    broadcastState();
    if (updateState.status === 'available' && updateState.latestVersion !== lastNotifiedUpdate) {
      lastNotifiedUpdate = updateState.latestVersion;
      notify(
        'Jisr update available',
        `Version ${updateState.latestVersion} is ready to download.`,
        showWindow,
      );
    }
  });
  discovery.on('devices', () => {
    broadcastState();
    refreshTrayMenu();
  });
  discovery.on('warning', (error) => sendToast({
    tone: 'warning',
    title: 'Local discovery needs attention',
    message: error.message,
  }));
  transfers.on('pairing', broadcastState);
  transfers.on('paired', (peer) => {
    broadcastState();
    sendToast({ tone: 'success', title: 'Devices paired', message: `${peer.name} is ready to share.` });
    notify('Devices paired', `${peer.name} is now connected securely.`);
  });
  transfers.on('transfers', broadcastState);
  transfers.on('progress', (transfer) => sendEvent('transfer-progress', transfer));
  transfers.on('incoming-request', (transfer) => {
    broadcastState();
    sendEvent('incoming-request', transfer);
    notify('Incoming transfer', `${transfer.peerName} wants to send ${transfer.summary}.`, showWindow);
  });
  transfers.on('message', (transfer) => {
    if (store.settings.copyReceivedText) clipboard.writeText(transfer.content);
    broadcastState();
    sendEvent('received-message', transfer);
    notify(
      transfer.kind === 'link' ? 'Link received' : 'Text received',
      `${transfer.peerName} sent ${transfer.kind === 'link' ? 'a link' : 'text'}${store.settings.copyReceivedText ? ' — copied to clipboard' : ''}.`,
      showWindow,
    );
  });
  transfers.on('completed', (transfer) => {
    broadcastState();
    sendToast({
      tone: 'success',
      title: transfer.direction === 'incoming' ? 'Received' : 'Sent',
      message: `${transfer.summary} ${transfer.direction === 'incoming' ? `from ${transfer.peerName}` : `to ${transfer.peerName}`}.`,
    });
    notify(
      transfer.direction === 'incoming' ? 'Transfer received' : 'Transfer complete',
      `${transfer.summary} ${transfer.direction === 'incoming' ? `from ${transfer.peerName}` : `sent to ${transfer.peerName}`}.`,
    );
  });
  transfers.on('failed', (transfer) => {
    broadcastState();
    sendToast({ tone: 'danger', title: 'Transfer stopped', message: transfer.error });
  });
}

function notify(title, body, onClick) {
  if (!store.settings.showNotifications || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: !store.settings.soundEnabled, icon: appIcon });
  if (onClick) notification.on('click', onClick);
  notification.show();
}

function combinedDevices() {
  const onlineById = new Map(discovery.list().map((device) => [device.id, device]));
  const devices = [];
  for (const peer of store.peers) {
    const online = onlineById.get(peer.id);
    devices.push({
      ...peer,
      ...(online || {}),
      name: peer.name,
      publicKey: undefined,
      online: Boolean(online),
      paired: true,
    });
    onlineById.delete(peer.id);
  }
  for (const device of onlineById.values()) {
    devices.push({ ...device, publicKey: undefined, online: true, paired: false, trusted: false });
  }
  return devices.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

function localAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

async function viewState() {
  const pairing = transfers.getPairingState();
  let pairingQr = null;
  if (pairing) {
    const address = localAddresses()[0] || '';
    const uri = `jisr://pair?device=${encodeURIComponent(store.identity.id)}&host=${encodeURIComponent(address)}&port=${transfers.port}&code=${pairing.code}`;
    pairingQr = await QRCode.toDataURL(uri, {
      width: 240,
      margin: 1,
      color: { dark: '#16131f', light: '#ffffff' },
    });
  }
  return {
    identity: {
      id: store.identity.id,
      name: store.settings.deviceName,
      platform: process.platform,
      fingerprint: store.identity.fingerprint,
      addresses: localAddresses(),
      port: transfers.port,
    },
    settings: { ...store.settings },
    devices: combinedDevices(),
    transfers: transfers.activeTransfers(),
    history: store.history,
    pairing: pairing ? { ...pairing, qr: pairingQr } : null,
    updates: updateService.publicState(),
    migration: migrationState,
  };
}

async function broadcastState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  sendEvent('state', await viewState());
}

function sendEvent(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function sendToast(payload) {
  sendEvent('toast', payload);
}

function validSender(event) {
  return mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!validSender(event)) throw new Error('Unauthorized request.');
    return callback(...args);
  });
}

function registerIpc() {
  handle('state:get', viewState);
  handle('dialog:files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose files to send',
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths.slice(0, MAX_SELECTED_PATHS);
  });
  handle('dialog:folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a folder to send',
      properties: ['openDirectory'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  handle('dialog:download', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose where received files are saved',
      defaultPath: store.settings.downloadPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('pairing:start', () => transfers.startPairing());
  handle('pairing:stop', () => transfers.stopPairing());
  handle('device:pair', async (id, code) => {
    const device = discovery.get(String(id));
    const peer = await transfers.pairWithDevice(device, code);
    await broadcastState();
    return { id: peer.id, name: peer.name };
  });
  handle('device:probe', async (address) => {
    const device = await discovery.probe(String(address || ''));
    await broadcastState();
    return { id: device.id, name: device.name };
  });
  handle('device:update', async (id, changes) => {
    await store.updatePeer(String(id), changes || {});
    await broadcastState();
  });
  handle('device:remove', async (id) => {
    await store.removePeer(String(id));
    await broadcastState();
  });
  handle('transfer:paths', async (peerId, paths) => {
    if (!Array.isArray(paths) || paths.length > MAX_SELECTED_PATHS) throw new Error('Too many selected paths.');
    return transfers.sendPaths(String(peerId), paths.map(String));
  });
  handle('transfer:text', (peerId, content, kind) => transfers.sendText(String(peerId), content, kind));
  handle('transfer:respond', (id, accept) => accept ? transfers.acceptIncoming(String(id)) : transfers.rejectIncoming(String(id)));
  handle('transfer:cancel', (id) => transfers.cancelTransfer(String(id)));
  handle('history:clear', async () => {
    await store.clearHistory();
    await broadcastState();
  });
  handle('updates:check', async () => {
    const result = await updateService.check({ manual: true });
    await broadcastState();
    return result;
  });
  handle('updates:download', async () => {
    const directory = path.join(
      process.platform === 'darwin' ? app.getPath('downloads') : app.getPath('temp'),
      'Jisr Updates',
    );
    return updateService.download(directory);
  });
  handle('updates:install', async () => {
    const installerPath = updateService.installerPath();
    if (!installerPath) throw new Error('The update has not finished downloading.');

    if (process.platform === 'darwin') {
      const error = await shell.openPath(installerPath);
      if (error) {
        updateService.setState({ error });
        throw new Error(error);
      }
      return { action: 'opened' };
    }
    if (process.platform !== 'win32') throw new Error('Automatic installation is not supported on this computer.');

    updateService.markInstalling();
    try {
      await new Promise((resolve, reject) => {
        const installer = spawn(installerPath, ['--updated', '/S', '--force-run'], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        installer.once('spawn', () => {
          installer.unref();
          resolve();
        });
        installer.once('error', reject);
      });
    } catch (error) {
      updateService.setState({ status: 'downloaded', error: error.message });
      throw error;
    }
    quitting = true;
    setTimeout(() => app.quit(), 250);
    return { action: 'restarting' };
  });
  handle('settings:update', async (changes) => {
    const previousName = store.settings.deviceName;
    await store.updateSettings(changes || {});
    if (previousName !== store.settings.deviceName || 'receivingEnabled' in (changes || {})) discovery.announce();
    applyLoginSetting();
    refreshTrayMenu();
    if (changes?.checkForUpdates === true) updateService.check({ manual: true }).catch(() => {});
    await broadcastState();
    return store.settings;
  });
  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', (value) => clipboard.writeText(String(value || '')));
  handle('shell:reveal', async (target) => {
    const resolved = path.resolve(String(target || store.settings.downloadPath));
    if (resolved !== path.resolve(store.settings.downloadPath) && !resolved.startsWith(`${path.resolve(store.settings.downloadPath)}${path.sep}`)) {
      throw new Error('That path is outside the Jisr download folder.');
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
  });
  handle('shell:open-link', async (value) => {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web links can be opened.');
    await shell.openExternal(url.toString());
  });
}

function applyLoginSetting() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: store.settings.launchAtLogin, openAsHidden: true });
}
