'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UpdateService,
  compareVersions,
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
          { name: 'Jisr-0.3.1-arm64.dmg', browser_download_url: 'https://github.com/example/arm.dmg' },
        ],
      }),
    }),
  });
  const state = await service.check({ manual: true });
  assert.equal(state.status, 'available');
  assert.equal(state.latestVersion, '0.3.1');
  assert.equal(state.assetName, 'Jisr-0.3.1-arm64.dmg');
});
