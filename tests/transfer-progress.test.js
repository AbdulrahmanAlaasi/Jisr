'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const transferProgress = require('../src/renderer/transfer-progress');

function formatBytes(bytes) {
  return `${bytes} B`;
}

function statusLabel(status) {
  return status;
}

test('patches only the matching transfer progress elements', () => {
  const detail = { textContent: '' };
  const track = {
    value: '',
    setAttribute(name, value) { if (name === 'aria-valuenow') this.value = value; },
  };
  const bar = { style: { width: '' } };
  const card = {
    dataset: { transferId: 'transfer-2' },
    querySelector(selector) {
      return {
        '[data-transfer-detail]': detail,
        '[role="progressbar"]': track,
        '[data-transfer-progress]': bar,
      }[selector] || null;
    },
  };
  const root = {
    querySelectorAll() {
      return [{ dataset: { transferId: 'transfer-1' } }, card];
    },
  };

  const patched = transferProgress.patch(root, {
    id: 'transfer-2', state: 'sending', currentBytes: 50, totalBytes: 100, progress: 0.5,
  }, formatBytes, statusLabel);

  assert.equal(patched, true);
  assert.equal(detail.textContent, '50 B of 100 B · 50%');
  assert.equal(track.value, '50');
  assert.equal(bar.style.width, '50%');
});

test('reports when the transfer card is not mounted', () => {
  const root = { querySelectorAll: () => [] };
  assert.equal(transferProgress.patch(root, { id: 'missing' }, formatBytes, statusLabel), false);
});

test('clamps invalid progress values safely', () => {
  assert.equal(transferProgress.percent({ progress: 1.8 }), 100);
  assert.equal(transferProgress.percent({ progress: -1 }), 0);
  assert.equal(transferProgress.percent({ progress: Number.NaN }), 0);
});
