'use strict';

(function exposeViewState(globalScope) {
  function visibleDevice(device) {
    return {
      id: device.id,
      name: device.name,
      platform: device.platform,
      paired: Boolean(device.paired),
      online: Boolean(device.online),
      fingerprint: device.fingerprint || '',
    };
  }

  function visibleTransfer(transfer) {
    return {
      id: transfer.id,
      direction: transfer.direction,
      state: transfer.state,
      peerName: transfer.peerName,
      summary: transfer.summary,
      itemNames: transfer.itemNames || [],
      totalBytes: transfer.totalBytes || 0,
      kind: transfer.kind,
    };
  }

  function signature(state, view) {
    if (!state) return '';
    if (view === 'history') return JSON.stringify(state.history || []);
    if (view === 'settings') {
      return JSON.stringify({
        settings: state.settings,
        identity: { fingerprint: state.identity?.fingerprint || '' },
        updates: state.updates,
        devices: (state.devices || []).map(visibleDevice),
      });
    }
    return JSON.stringify({
      identity: { name: state.identity?.name || '', platform: state.identity?.platform || '' },
      receivingEnabled: Boolean(state.settings?.receivingEnabled),
      devices: (state.devices || []).map(visibleDevice),
      transfers: (state.transfers || []).map(visibleTransfer),
    });
  }

  const api = { signature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.JisrViewState = api;
}(typeof window !== 'undefined' ? window : null));
