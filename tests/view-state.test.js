'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const viewState = require('../src/renderer/view-state');

function makeState() {
  return {
    identity: { name: 'My PC', platform: 'win32', fingerprint: 'ABCD' },
    settings: { receivingEnabled: true, deviceName: 'My PC' },
    devices: [{ id: 'mac', name: 'Mac', platform: 'darwin', paired: true, online: true, lastSeen: 1 }],
    transfers: [{ id: 'one', state: 'sending', direction: 'outgoing', peerName: 'Mac', summary: 'Folder', itemNames: ['Folder'], totalBytes: 100, currentBytes: 20, progress: 0.2, kind: 'folder' }],
    history: [],
    updates: { status: 'idle' },
  };
}

test('home signature ignores background timestamps and chunk progress', () => {
  const before = makeState();
  const after = structuredClone(before);
  after.devices[0].lastSeen = 999;
  after.transfers[0].currentBytes = 75;
  after.transfers[0].progress = 0.75;
  assert.equal(viewState.signature(before, 'home'), viewState.signature(after, 'home'));
});

test('home signature detects changes that alter the visible layout', () => {
  const before = makeState();
  const after = structuredClone(before);
  after.devices[0].online = false;
  assert.notEqual(viewState.signature(before, 'home'), viewState.signature(after, 'home'));

  after.devices[0].online = true;
  after.transfers[0].state = 'complete';
  assert.notEqual(viewState.signature(before, 'home'), viewState.signature(after, 'home'));
});

test('device discovery does not redraw the history view', () => {
  const before = makeState();
  const after = structuredClone(before);
  after.devices.push({ id: 'pc-2', name: 'PC 2', online: true });
  assert.equal(viewState.signature(before, 'history'), viewState.signature(after, 'history'));
});
