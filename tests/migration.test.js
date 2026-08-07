'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyPreferences } = require('../src/main/migration');

test('legacy preferences migrate without copying identity or paired-device keys', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jisr-migration-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyDirectory = path.join(root, 'OrbitSend');
  const targetDirectory = path.join(root, 'Jisr');
  const downloadsPath = path.join(root, 'Downloads');
  await fs.mkdir(legacyDirectory, { recursive: true });
  await fs.writeFile(path.join(legacyDirectory, 'settings.json'), JSON.stringify({
    deviceName: 'My Mac',
    downloadPath: path.join(downloadsPath, 'OrbitSend'),
    receivingEnabled: true,
  }));
  await fs.writeFile(path.join(legacyDirectory, 'history.json'), JSON.stringify([{ id: 'history-1' }]));
  await fs.writeFile(path.join(legacyDirectory, 'identity.json'), JSON.stringify({ protected: true, data: 'secret' }));
  await fs.writeFile(path.join(legacyDirectory, 'peers.json'), JSON.stringify([{ id: 'peer-1' }]));

  const result = await migrateLegacyPreferences({ legacyDirectory, targetDirectory, downloadsPath });
  assert.equal(result.migrated, true);
  const settings = JSON.parse(await fs.readFile(path.join(targetDirectory, 'settings.json'), 'utf8'));
  assert.equal(settings.deviceName, 'My Mac');
  assert.equal(settings.downloadPath, path.join(downloadsPath, 'Jisr'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetDirectory, 'history.json'), 'utf8')), [{ id: 'history-1' }]);
  await assert.rejects(fs.access(path.join(targetDirectory, 'identity.json')));
  await assert.rejects(fs.access(path.join(targetDirectory, 'peers.json')));

  const secondRun = await migrateLegacyPreferences({ legacyDirectory, targetDirectory, downloadsPath });
  assert.equal(secondRun.alreadyCompleted, true);
});

test('migration never overwrites preferences already created by Jisr', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jisr-existing-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacyDirectory = path.join(root, 'OrbitSend');
  const targetDirectory = path.join(root, 'Jisr');
  const downloadsPath = path.join(root, 'Downloads');
  await fs.mkdir(legacyDirectory, { recursive: true });
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.writeFile(path.join(legacyDirectory, 'settings.json'), JSON.stringify({ deviceName: 'Old name' }));
  await fs.writeFile(path.join(legacyDirectory, 'history.json'), JSON.stringify([{ id: 'old-history' }]));
  await fs.writeFile(path.join(targetDirectory, 'settings.json'), JSON.stringify({ deviceName: 'Jisr name' }));
  await fs.writeFile(path.join(targetDirectory, 'history.json'), JSON.stringify([{ id: 'jisr-history' }]));

  const result = await migrateLegacyPreferences({ legacyDirectory, targetDirectory, downloadsPath });
  assert.equal(result.migrated, false);
  assert.equal(result.settingsMigrated, false);
  assert.equal(result.historyMigrated, false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetDirectory, 'settings.json'), 'utf8')), {
    deviceName: 'Jisr name',
  });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetDirectory, 'history.json'), 'utf8')), [{
    id: 'jisr-history',
  }]);
});
