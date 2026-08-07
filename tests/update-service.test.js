'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  UpdateService,
  compareVersions,
  isTrustedUpdateUrl,
  parseAssetDigest,
  parseVersion,
  selectReleaseAsset,
} = require('../src/main/update-service');

test('semantic versions are parsed and compared', () => {
  assert.deepEqual(parseVersion('v1.12.3'), [1, 12, 3]);
  assert.equal(parseVersion('not-a-version'), null);
  assert.equal(compareVersions('0.3.1', '0.3.0'), 1);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
});

test('the correct installer is selected for each platform', () => {
  const assets = [
    { name: 'Jisr-0.4.0-arm64.dmg', browser_download_url: 'https://example/arm.dmg' },
    { name: 'Jisr-0.4.0.dmg', browser_download_url: 'https://example/intel.dmg' },
    { name: 'Jisr Setup 0.4.0.exe', browser_download_url: 'https://example/setup.exe' },
  ];
  assert.equal(selectReleaseAsset(assets, 'darwin', 'arm64').name, 'Jisr-0.4.0-arm64.dmg');
  assert.equal(selectReleaseAsset(assets, 'darwin', 'x64').name, 'Jisr-0.4.0.dmg');
  assert.equal(selectReleaseAsset(assets, 'win32', 'x64').name, 'Jisr Setup 0.4.0.exe');
});

test('only checksummed installers from the Jisr release channels are trusted', () => {
  const checksum = 'a'.repeat(64);
  assert.equal(parseAssetDigest(`sha256:${checksum}`), checksum);
  assert.equal(parseAssetDigest('sha256:not-valid'), null);
  assert.equal(isTrustedUpdateUrl('https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/download/v1/Jisr.exe'), true);
  assert.equal(isTrustedUpdateUrl('https://example.com/Jisr.exe'), false);
});

test('an available update includes the platform download', async () => {
  const service = new UpdateService({
    currentVersion: '0.3.0',
    platform: 'darwin',
    arch: 'arm64',
    fetcher: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v0.3.1',
        name: 'Jisr 0.3.1',
        body: 'A smaller, faster release.',
        html_url: 'https://github.com/example/release',
        assets: [
          { name: 'Jisr-0.3.1-arm64.dmg', browser_download_url: 'https://github.com/example/arm.dmg', digest: `sha256:${'b'.repeat(64)}`, size: 42 },
        ],
      }),
    }),
  });
  const state = await service.check({ manual: true });
  assert.equal(state.status, 'available');
  assert.equal(state.latestVersion, '0.3.1');
  assert.equal(state.assetName, 'Jisr-0.3.1-arm64.dmg');
  assert.equal(state.assetDigest, 'b'.repeat(64));
  assert.equal(state.assetSize, 42);
});

test('an update is streamed to disk and verified before it becomes installable', async () => {
  const installer = Buffer.from('verified Jisr installer fixture');
  const digest = crypto.createHash('sha256').update(installer).digest('hex');
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'jisr-update-'));
  let requests = 0;
  const service = new UpdateService({
    currentVersion: '0.4.1',
    platform: 'win32',
    arch: 'x64',
    fetcher: async (url) => {
      requests += 1;
      if (requests === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tag_name: 'v0.4.2',
            name: 'Jisr 0.4.2',
            body: 'Safer updates.',
            html_url: 'https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/tag/v0.4.2',
            assets: [{
              name: 'Jisr.Setup.0.4.2.exe',
              browser_download_url: 'https://github.com/AbdulrahmanAlaasi/OrbitSend-Updates/releases/download/v0.4.2/Jisr.Setup.0.4.2.exe',
              digest: `sha256:${digest}`,
              size: installer.length,
            }],
          }),
        };
      }
      return new Response(installer, {
        status: 200,
        headers: { 'content-length': String(installer.length) },
      });
    },
  });

  try {
    await service.check({ manual: true });
    const state = await service.download(destination);
    assert.equal(state.status, 'downloaded');
    assert.equal(state.downloadPercent, 100);
    assert.equal(await fs.readFile(service.installerPath(), 'utf8'), installer.toString());
  } finally {
    await fs.rm(destination, { recursive: true, force: true });
  }
});
