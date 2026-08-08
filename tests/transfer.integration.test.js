'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JisrStore } = require('../src/main/store');
const { TransferService, cleanRelativePath } = require('../src/main/transfer-service');

class MemoryDiscovery {
  constructor() { this.devices = new Map(); }
  get(id) { return this.devices.get(id) || null; }
}

async function waitFor(check, timeout = 8_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for transfer state.');
}

async function createDevice(root, name) {
  const dataPath = path.join(root, `${name}-data`);
  const downloadsPath = path.join(root, `${name}-downloads`);
  const store = await new JisrStore(dataPath, null, downloadsPath).init();
  await store.updateSettings({ deviceName: name, showNotifications: false });
  const discovery = new MemoryDiscovery();
  const service = new TransferService(store, discovery);
  await service.start();
  return { store, discovery, service };
}

async function pairDevices(alice, bob) {
  const aliceDevice = { ...alice.service.publicIdentity(), address: '127.0.0.1' };
  const bobDevice = { ...bob.service.publicIdentity(), address: '127.0.0.1' };
  alice.discovery.devices.set(bobDevice.id, bobDevice);
  bob.discovery.devices.set(aliceDevice.id, aliceDevice);
  const pairing = bob.service.startPairing();
  await alice.service.pairWithDevice(bobDevice, pairing.code);
  return { aliceDevice, bobDevice };
}

test('path sanitization blocks traversal and reserved characters', () => {
  assert.equal(cleanRelativePath('../../secret?.txt'), 'secret_.txt');
  assert.equal(cleanRelativePath('folder\\report:final.txt'), 'folder/report_final.txt');
  assert.equal(cleanRelativePath('/../'), 'untitled');
});

test('two same-OS devices pair, exchange text, and transfer a verified file', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jisr-test-'));
  const alice = await createDevice(root, 'Windows PC');
  const bob = await createDevice(root, 'MacBook Pro');
  assert.equal(alice.service.publicIdentity().platform, process.platform);
  assert.equal(bob.service.publicIdentity().platform, process.platform);
  t.after(async () => {
    await Promise.all([alice.service.stop(), bob.service.stop()]);
    await fs.rm(root, { recursive: true, force: true });
  });

  const { bobDevice } = await pairDevices(alice, bob);
  assert.equal(alice.store.getPeer(bobDevice.id).name, 'MacBook Pro');
  assert.equal(bob.store.getPeer(alice.store.identity.id).name, 'Windows PC');

  let receivedText = null;
  bob.service.once('message', (transfer) => { receivedText = transfer; });
  const message = await alice.service.sendText(bob.store.identity.id, 'https://example.com/demo', 'link');
  await waitFor(() => receivedText);
  await waitFor(() => alice.store.history.find((entry) => entry.id === message.id)?.status === 'complete');
  assert.equal(receivedText.content, 'https://example.com/demo');

  const sourcePath = path.join(root, 'sample-video.bin');
  const source = Buffer.alloc(2_500_000);
  for (let index = 0; index < source.length; index += 1) source[index] = index % 251;
  await fs.writeFile(sourcePath, source);

  bob.service.once('incoming-request', (transfer) => {
    bob.service.acceptIncoming(transfer.id).catch(() => {});
  });
  const queued = await alice.service.sendPaths(bob.store.identity.id, [sourcePath]);
  await waitFor(() => alice.store.history.find((entry) => entry.id === queued.id)?.status === 'complete', 15_000);

  const receivedPath = path.join(bob.store.settings.downloadPath, 'sample-video.bin');
  const received = await fs.readFile(receivedPath);
  assert.equal(received.length, source.length);
  assert.deepEqual(received, source);
});
