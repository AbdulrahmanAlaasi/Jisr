'use strict';

(function exposeTransferProgress(globalScope) {
  function percent(transfer) {
    return Math.max(0, Math.min(100, Math.round((Number(transfer?.progress) || 0) * 100)));
  }

  function detail(transfer, formatBytes, statusLabel, value = percent(transfer)) {
    if (transfer.state === 'pending') {
      return transfer.direction === 'outgoing' ? `Waiting for ${transfer.peerName}` : 'Waiting for your approval';
    }
    if (['sending', 'receiving'].includes(transfer.state)) {
      return `${formatBytes(transfer.currentBytes)} of ${formatBytes(transfer.totalBytes)} · ${value}%`;
    }
    return `${statusLabel(transfer.state)} · ${transfer.peerName}`;
  }

  function patch(root, transfer, formatBytes, statusLabel) {
    const card = Array.from(root.querySelectorAll('[data-transfer-id]'))
      .find((element) => element.dataset.transferId === String(transfer.id));
    if (!card) return false;

    const value = percent(transfer);
    const detailElement = card.querySelector('[data-transfer-detail]');
    const track = card.querySelector('[role="progressbar"]');
    const bar = card.querySelector('[data-transfer-progress]');
    if (detailElement) detailElement.textContent = detail(transfer, formatBytes, statusLabel, value);
    if (track) track.setAttribute('aria-valuenow', String(value));
    if (bar) bar.style.width = `${Math.max(3, value)}%`;
    return true;
  }

  const api = { percent, detail, patch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.JisrTransferProgress = api;
}(typeof window !== 'undefined' ? window : null));
