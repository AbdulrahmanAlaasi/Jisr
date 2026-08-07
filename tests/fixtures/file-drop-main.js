'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

async function run() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadFile(path.join(__dirname, 'file-drop.html'));
  window.webContents.debugger.attach('1.3');
  const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
  const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#drop-file',
  });
  await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
    nodeId,
    files: [process.env.JISR_DROP_FIXTURE],
  });

  const resolvedPath = await window.webContents.executeJavaScript(
    "window.jisr.pathFromFile(document.getElementById('drop-file').files[0])",
  );
  process.stdout.write(`${JSON.stringify({ resolvedPath })}\n`);
  app.quit();
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});
