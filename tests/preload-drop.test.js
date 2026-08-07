'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('the sandboxed preload resolves a real dropped file path', async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'jisr-drop-'));
  const filePath = path.join(tempDirectory, 'drag-drop-proof.txt');
  await fs.writeFile(filePath, 'Jisr drag-and-drop verification.');

  try {
    const result = await new Promise((resolve, reject) => {
      const environment = { ...process.env, JISR_DROP_FIXTURE: filePath };
      delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [path.join(__dirname, 'fixtures', 'file-drop-main.js')], {
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Electron file-drop test timed out.'));
      }, 20_000);
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(path.resolve(payload.resolvedPath), path.resolve(filePath));
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
