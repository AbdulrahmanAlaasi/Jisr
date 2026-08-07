'use strict';

const ui = {
  state: null,
  view: 'home',
  selectedDeviceId: null,
  composeKind: 'link',
  composeValue: '',
  historyFilter: 'all',
  historySearch: '',
  dragDepth: 0,
};

const mainView = document.getElementById('main-view');
const modalRoot = document.getElementById('modal-root');
const toastStack = document.getElementById('toast-stack');
const dropOverlay = document.getElementById('drop-overlay');

const icons = {
  computer: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-6-4-1 4m5-4 1 4"/></svg>',
  laptop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="12" rx="2"/><path d="M2 18h20l-1 2H3z"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M5 20h14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.7 2.8 8.3 7 10 4.2-1.7 7-5.3 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function platformLabel(platform) {
  if (platform === 'darwin') return 'Mac';
  if (platform === 'win32') return 'Windows PC';
  return 'Computer';
}

function deviceIcon(platform) {
  return platform === 'darwin' ? icons.laptop : icons.computer;
}

function fileIcon(kind) {
  if (kind === 'folder') return '▱';
  if (kind === 'link') return '↗';
  if (kind === 'text' || kind === 'clipboard') return '¶';
  return '⇧';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / (1024 ** index);
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

function hasDraggedFiles(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes('Files');
}

function pathsFromDrop(dataTransfer) {
  return Array.from(dataTransfer?.files || [])
    .map((file) => window.orbit.pathFromFile(file))
    .filter(Boolean);
}

function timeAgo(value) {
  const time = new Date(value).getTime();
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function statusLabel(status) {
  const labels = {
    connecting: 'Connecting', pending: 'Waiting', accepted: 'Starting', sending: 'Sending',
    receiving: 'Receiving', complete: 'Complete', failed: 'Failed', rejected: 'Declined', canceled: 'Canceled',
  };
  return labels[status] || status;
}

function selectedDevice() {
  return ui.state?.devices.find((device) => device.id === ui.selectedDeviceId) || null;
}

function ensureSelection() {
  const current = selectedDevice();
  if (current?.paired && current.online) return;
  const first = ui.state?.devices.find((device) => device.paired && device.online);
  ui.selectedDeviceId = first?.id || null;
}

function updateChrome() {
  document.body.classList.toggle('platform-darwin', ui.state?.identity.platform === 'darwin');
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === ui.view);
  });
  const historyBadge = document.getElementById('history-badge');
  const failed = ui.state?.history.filter((item) => item.status === 'failed').length || 0;
  historyBadge.hidden = failed === 0;
  historyBadge.textContent = String(failed);
  const localDevice = document.getElementById('local-device');
  const updateSlot = document.getElementById('update-slot');
  const update = ui.state?.updates;
  if (updateSlot) {
    updateSlot.innerHTML = update?.status === 'available' ? `
      <button class="update-alert" data-action="update-open">
        <span class="update-alert-icon">↻</span>
        <span><strong>Update available</strong><small>Version ${escapeHtml(update.latestVersion)}</small></span>
      </button>` : '';
  }
  if (ui.state) {
    localDevice.innerHTML = `
      <div class="local-avatar">${ui.state.identity.platform === 'darwin' ? '⌘' : '⊞'}</div>
      <div class="local-copy"><strong>${escapeHtml(ui.state.identity.name)}</strong><span>This device</span></div>`;
  }
}

function render() {
  if (!ui.state) {
    mainView.innerHTML = '<div class="empty-state"><div class="empty-state-icon">◌</div><strong>Starting OrbitSend…</strong><span>Preparing a private connection on your local network.</span></div>';
    return;
  }
  ensureSelection();
  updateChrome();
  if (ui.view === 'history') renderHistory();
  else if (ui.view === 'settings') renderSettings();
  else renderHome();
}

function renderHome() {
  const state = ui.state;
  const device = selectedDevice();
  const pairedOnline = state.devices.filter((item) => item.paired && item.online);
  const pending = state.transfers.filter((transfer) => transfer.direction === 'incoming' && transfer.state === 'pending');
  const active = state.transfers.filter((transfer) => !['complete', 'failed', 'rejected', 'canceled'].includes(transfer.state));
  const allDevices = state.devices;

  mainView.innerHTML = `
    <div class="content">
      <header class="page-head">
        <div><span class="eyebrow">OrbitSend</span><h1>Your devices, one drop away.</h1><p>Choose a computer, then send files, folders, links, or text directly.</p></div>
        <button class="status-button ${state.settings.receivingEnabled ? '' : 'paused'}" data-action="toggle-receiving">
          <span class="status-dot"></span>${state.settings.receivingEnabled ? 'Ready to receive' : 'Receiving paused'}
        </button>
      </header>

      ${pending.map(renderIncomingNotice).join('')}

      <section class="section">
        <div class="section-heading">
          <h2>Nearby devices</h2>
          <button class="button ghost small" data-action="pair-open">+ Pair a device</button>
        </div>
        ${allDevices.length ? `<div class="device-row">${allDevices.map(renderDeviceCard).join('')}</div>` : `
          <div class="empty-device">
            <span>No other OrbitSend devices found yet. Open OrbitSend on your other computer.</span>
            <button class="button small" data-action="pair-open">Pair manually</button>
          </div>`}
      </section>

      <section class="send-panel">
        <div class="send-panel-head">
          <div class="send-to"><span>Send to</span><strong>${device ? escapeHtml(device.name) : 'Select a paired device'}</strong></div>
          <div class="encrypted-label">${icons.lock} Encrypted direct transfer</div>
        </div>
        <div class="send-grid">
          <div class="drop-zone ${device ? '' : 'disabled'}">
            <div class="drop-zone-icon">${icons.upload}</div>
            <strong>${device ? 'Drop anything here' : 'Choose an online device first'}</strong>
            <p>${device ? 'Files, folders, photos, and videos — direct and encrypted.' : 'Pair both computers and keep OrbitSend open on each.'}</p>
            <div class="drop-actions">
              <button class="button small" data-action="choose-files" ${device ? '' : 'disabled'}>Choose files</button>
              <button class="button small" data-action="choose-folder" ${device ? '' : 'disabled'}>Choose folder</button>
            </div>
          </div>
          <div class="quick-share">
            <div class="quick-tabs">
              <button class="quick-tab ${ui.composeKind === 'link' ? 'active' : ''}" data-action="compose-kind" data-kind="link">Link</button>
              <button class="quick-tab ${ui.composeKind === 'text' ? 'active' : ''}" data-action="compose-kind" data-kind="text">Text</button>
            </div>
            <textarea id="compose-value" maxlength="2000000" placeholder="${ui.composeKind === 'link' ? 'Paste a web link…' : 'Type or paste text…'}" ${device ? '' : 'disabled'}>${escapeHtml(ui.composeValue)}</textarea>
            <div class="quick-share-foot">
              <button class="clipboard-button" data-action="paste-clipboard" ${device ? '' : 'disabled'}>Paste clipboard</button>
              <button class="button primary small" data-action="send-text" ${device ? '' : 'disabled'}>Send now</button>
            </div>
          </div>
        </div>
      </section>

      ${active.length ? `
        <section class="section">
          <div class="section-heading"><h2>In progress</h2><span>${active.length} active</span></div>
          <div class="transfer-list">${active.map(renderTransferCard).join('')}</div>
        </section>` : ''}

      ${!pairedOnline.length && allDevices.some((item) => item.paired) ? '<p class="pair-help">Your paired devices are offline. Make sure both computers are on the same Wi‑Fi and receiving is enabled.</p>' : ''}
    </div>`;

  const compose = document.getElementById('compose-value');
  compose?.addEventListener('input', () => { ui.composeValue = compose.value; });
  document.getElementById('drop-device-label').textContent = device ? `Send to ${device.name}` : 'Choose a device first';
}

function renderDeviceCard(device) {
  if (!device.paired) {
    return `
      <button class="device-card unpaired" data-action="pair-device" data-id="${escapeHtml(device.id)}">
        <div class="device-avatar">${deviceIcon(device.platform)}<span class="online-dot"></span></div>
        <div class="device-copy"><strong>${escapeHtml(device.name)}</strong><span>Tap to pair securely</span></div>
      </button>`;
  }
  const selected = ui.selectedDeviceId === device.id;
  return `
    <div class="device-card ${selected ? 'selected' : ''} ${device.online ? '' : 'offline'}" data-action="select-device" data-id="${escapeHtml(device.id)}">
      <div class="device-avatar">${deviceIcon(device.platform)}${device.online ? '<span class="online-dot"></span>' : ''}</div>
      <div class="device-copy"><strong>${escapeHtml(device.name)}</strong><span>${device.online ? `${platformLabel(device.platform)} · Ready` : 'Offline'}</span></div>
      <button class="device-more" aria-label="Device settings" data-action="device-settings" data-id="${escapeHtml(device.id)}">•••</button>
    </div>`;
}

function renderIncomingNotice(transfer) {
  return `
    <div class="notice">
      <div class="notice-copy"><div class="notice-icon">↓</div><div><strong>${escapeHtml(transfer.peerName)} wants to send ${escapeHtml(transfer.summary)}</strong><span>${escapeHtml(transfer.itemNames.join(', '))} · ${formatBytes(transfer.totalBytes)}</span></div></div>
      <div class="transfer-actions">
        <button class="button small ghost" data-action="reject-transfer" data-id="${transfer.id}">Decline</button>
        <button class="button small primary" data-action="accept-transfer" data-id="${transfer.id}">Accept</button>
      </div>
    </div>`;
}

function renderTransferCard(transfer) {
  const percent = Math.round((transfer.progress || 0) * 100);
  const isPendingIncoming = transfer.direction === 'incoming' && transfer.state === 'pending';
  const detail = transfer.state === 'pending'
    ? transfer.direction === 'outgoing' ? `Waiting for ${escapeHtml(transfer.peerName)}` : 'Waiting for your approval'
    : ['sending', 'receiving'].includes(transfer.state)
      ? `${formatBytes(transfer.currentBytes)} of ${formatBytes(transfer.totalBytes)} · ${percent}%`
      : `${statusLabel(transfer.state)} · ${escapeHtml(transfer.peerName)}`;
  return `
    <div class="transfer-card" data-transfer-id="${transfer.id}">
      <div class="transfer-icon">${fileIcon(transfer.kind)}</div>
      <div class="transfer-copy">
        <div class="transfer-line"><strong>${escapeHtml(transfer.summary)}</strong><span>${detail}</span></div>
        <div class="progress-track"><div class="progress-bar" style="width:${transfer.state === 'pending' ? 4 : Math.max(3, percent)}%"></div></div>
      </div>
      <div class="transfer-actions">
        ${isPendingIncoming ? `<button class="button small primary" data-action="accept-transfer" data-id="${transfer.id}">Accept</button>` : ''}
        <button class="button small ghost" data-action="cancel-transfer" data-id="${transfer.id}">${isPendingIncoming ? 'Decline' : 'Cancel'}</button>
      </div>
    </div>`;
}

function renderHistory() {
  const query = ui.historySearch.trim().toLowerCase();
  const entries = ui.state.history.filter((entry) => {
    if (ui.historyFilter !== 'all' && entry.direction !== ui.historyFilter) return false;
    if (!query) return true;
    return [entry.peerName, entry.summary, ...(entry.itemNames || []), entry.content].join(' ').toLowerCase().includes(query);
  });
  mainView.innerHTML = `
    <div class="content">
      <header class="page-head">
        <div><h1>Transfer history</h1><p>Everything sent and received on this device. File contents are never stored in the history.</p></div>
        ${ui.state.history.length ? '<button class="button small ghost" data-action="clear-history">Clear history</button>' : ''}
      </header>
      <div class="history-toolbar">
        <div class="search">${icons.search}<input id="history-search" value="${escapeHtml(ui.historySearch)}" placeholder="Search files, devices, or links"></div>
        <div class="filter-tabs">
          ${[['all','All'],['incoming','Received'],['outgoing','Sent']].map(([value,label]) => `<button class="filter-tab ${ui.historyFilter === value ? 'active' : ''}" data-action="history-filter" data-filter="${value}">${label}</button>`).join('')}
        </div>
      </div>
      <div class="history-list">
        ${entries.length ? entries.map(renderHistoryItem).join('') : `
          <div class="empty-state"><div class="empty-state-icon">↕</div><strong>${query ? 'No matching transfers' : 'No transfers yet'}</strong><span>${query ? 'Try a different search.' : 'Files, links, and text you share will appear here.'}</span></div>`}
      </div>
    </div>`;
  const search = document.getElementById('history-search');
  search?.addEventListener('input', () => {
    ui.historySearch = search.value;
    window.clearTimeout(search._timer);
    search._timer = window.setTimeout(renderHistory, 120);
  });
  if (query) {
    search?.focus();
    search?.setSelectionRange(search.value.length, search.value.length);
  }
}

function renderHistoryItem(entry) {
  const isMessage = ['link', 'text', 'clipboard'].includes(entry.kind);
  const title = isMessage ? (entry.kind === 'link' ? entry.content : entry.summary) : (entry.itemNames?.[0] || entry.summary);
  return `
    <div class="history-item">
      <div class="transfer-icon">${fileIcon(entry.kind)}</div>
      <div class="history-main">
        <strong>${escapeHtml(title)}</strong>
        <span>${entry.direction === 'incoming' ? 'From' : 'To'} ${escapeHtml(entry.peerName)}${entry.itemNames?.length > 1 ? ` · +${entry.itemNames.length - 1} more` : ''}</span>
        ${isMessage && entry.kind !== 'link' ? `<div class="message-preview">${escapeHtml(entry.content)}</div>` : ''}
      </div>
      <span class="history-meta size">${entry.totalBytes ? formatBytes(entry.totalBytes) : entry.kind}</span>
      <span class="history-status ${escapeHtml(entry.status)}">${statusLabel(entry.status)}</span>
      <div class="history-meta">
        ${timeAgo(entry.createdAt)}
        ${entry.status === 'complete' && entry.direction === 'incoming' && !isMessage ? `<button class="device-more" title="Open download folder" data-action="reveal-download">↗</button>` : ''}
        ${entry.status === 'complete' && entry.kind === 'link' ? `<button class="device-more" title="Open link" data-action="history-open-link" data-id="${entry.id}">↗</button>` : ''}
        ${entry.status === 'complete' && isMessage ? `<button class="device-more" title="Copy" data-action="history-copy" data-id="${entry.id}">⧉</button>` : ''}
      </div>
    </div>`;
}

function renderSettings() {
  const { settings, identity, updates } = ui.state;
  mainView.innerHTML = `
    <div class="content">
      <header class="page-head"><div><h1>Settings</h1><p>Control how this computer appears and receives things.</p></div></header>
      <div class="settings-layout">
        <section class="settings-card">
          <div class="settings-card-head"><h2>This device</h2><p>Your device name and local identity are visible only to OrbitSend devices nearby.</p></div>
          <div class="setting-row"><div class="setting-copy"><strong>Device name</strong><span>Shown on your other computers.</span></div><input class="setting-input" data-setting-text="deviceName" value="${escapeHtml(settings.deviceName)}" maxlength="40"></div>
          <div class="setting-row"><div class="setting-copy"><strong>Security fingerprint</strong><span>Use this to double-check a paired connection.</span></div><code class="fingerprint">${escapeHtml(identity.fingerprint)}</code></div>
          <div class="setting-row"><div class="setting-copy"><strong>Start at login</strong><span>Keep OrbitSend ready in the background.</span></div>${renderSwitch('launchAtLogin', settings.launchAtLogin)}</div>
          <div class="setting-row"><div class="setting-copy"><strong>Keep running in tray</strong><span>Closing the window keeps transfers available.</span></div>${renderSwitch('keepRunningInTray', settings.keepRunningInTray)}</div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head"><h2>Receiving</h2><p>Incoming files are verified before appearing in your download folder.</p></div>
          <div class="setting-row"><div class="setting-copy"><strong>Save received files to</strong><span>OrbitSend creates safe, non-overwriting file names.</span></div><div class="path-control"><span class="path-value" title="${escapeHtml(settings.downloadPath)}">${escapeHtml(settings.downloadPath)}</span><button class="button small" data-action="choose-download">Change</button></div></div>
          <div class="setting-row"><div class="setting-copy"><strong>Auto-accept trusted devices</strong><span>Only devices you individually mark as trusted.</span></div>${renderSwitch('autoAcceptTrusted', settings.autoAcceptTrusted)}</div>
          <div class="setting-row"><div class="setting-copy"><strong>Copy received links and text</strong><span>Places secure messages on your clipboard automatically.</span></div>${renderSwitch('copyReceivedText', settings.copyReceivedText)}</div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head"><h2>Updates</h2><p>Check the public installer channel without exposing the private source repository.</p></div>
          <div class="setting-row"><div class="setting-copy"><strong>Automatically check for updates</strong><span>Checks when OrbitSend opens and every six hours.</span></div>${renderSwitch('checkForUpdates', settings.checkForUpdates)}</div>
          <div class="setting-row"><div class="setting-copy"><strong>OrbitSend ${escapeHtml(updates.currentVersion)}</strong><span>${updates.status === 'available' ? `Version ${escapeHtml(updates.latestVersion)} is available.` : updates.status === 'checking' ? 'Checking for updates…' : updates.error ? escapeHtml(updates.error) : 'You can check at any time.'}</span></div><button class="button small ${updates.status === 'available' ? 'primary' : ''}" data-action="${updates.status === 'available' ? 'update-open' : 'update-check'}" ${updates.status === 'checking' ? 'disabled' : ''}>${updates.status === 'available' ? 'View update' : updates.status === 'checking' ? 'Checking…' : 'Check now'}</button></div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head"><h2>Notifications</h2><p>Stay informed without keeping the main window open.</p></div>
          <div class="setting-row"><div class="setting-copy"><strong>Desktop notifications</strong><span>Incoming requests and completed transfers.</span></div>${renderSwitch('showNotifications', settings.showNotifications)}</div>
          <div class="setting-row"><div class="setting-copy"><strong>Notification sound</strong><span>Play the system notification sound.</span></div>${renderSwitch('soundEnabled', settings.soundEnabled)}</div>
        </section>

        <section class="settings-card">
          <div class="settings-card-head"><h2>Paired devices</h2><p>Manage persistent encrypted connections.</p></div>
          ${ui.state.devices.filter((device) => device.paired).length ? ui.state.devices.filter((device) => device.paired).map((device) => `
            <div class="setting-row"><div class="setting-copy"><strong>${escapeHtml(device.name)}</strong><span>${platformLabel(device.platform)} · ${device.online ? 'Online' : 'Offline'} · ${escapeHtml(device.fingerprint)}</span></div><button class="button small" data-action="device-settings" data-id="${device.id}">Manage</button></div>`).join('') : '<div class="setting-row"><div class="setting-copy"><strong>No paired devices</strong><span>Pair your Mac and PC from the Send page.</span></div><button class="button small" data-action="go-send">Pair</button></div>'}
        </section>
      </div>
    </div>`;
}

function renderSwitch(key, checked) {
  return `<label class="switch"><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}><span></span></label>`;
}

function openModal(content, className = '') {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal ${className}">${content}</div></div>`;
}

function closeModal() {
  modalRoot.innerHTML = '';
}

async function showPairingModal() {
  await window.orbit.startPairing();
  ui.state = await window.orbit.getState();
  const pairing = ui.state.pairing;
  openModal(`
    <div class="modal-head"><div><h2>Pair another computer</h2><p>On your other device, select <strong>${escapeHtml(ui.state.identity.name)}</strong> and enter this code.</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-body">
      ${pairing?.qr ? `<div class="qr-wrap"><img src="${pairing.qr}" alt="Pairing QR code"></div>` : ''}
      <div class="pair-code">${String(pairing?.code || '------').split('').map((digit) => `<span class="pair-digit">${digit}</span>`).join('')}</div>
      <span class="pair-expiry" id="pair-expiry">Code expires in 5:00</span>
      <div class="pair-help">Both devices should be on the same Wi‑Fi. The code protects the key exchange from anyone else on the network.</div>
    </div>
    <div class="modal-foot"><button class="button ghost" data-action="manual-connect-open">Connect by IP</button><button class="button ghost" data-action="stop-pairing">Stop pairing</button><button class="button primary" data-action="modal-close">Done</button></div>
  `);
  updatePairExpiry();
}

function showManualConnect() {
  const ownAddress = `${ui.state.identity.addresses[0] || '127.0.0.1'}:${ui.state.identity.port}`;
  openModal(`
    <div class="modal-head"><div><h2>Connect by IP address</h2><p>Use this when your network blocks automatic nearby-device discovery.</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-body">
      <div class="pair-help">This computer’s address: <span class="fingerprint">${escapeHtml(ownAddress)}</span></div>
      <div class="field"><label for="manual-address">Other computer’s OrbitSend address</label><input id="manual-address" placeholder="192.168.1.24:53318"></div>
      <div class="security-note">${icons.shield}<span>Enter an address only from a computer you control. Pairing still requires its six-digit code.</span></div>
    </div>
    <div class="modal-foot"><button class="button ghost" data-action="pair-open">Back</button><button class="button primary" data-action="manual-probe">Find device</button></div>
  `);
  document.getElementById('manual-address')?.focus();
}

function updatePairExpiry() {
  const label = document.getElementById('pair-expiry');
  if (!label || !ui.state?.pairing) return;
  const remaining = Math.max(0, ui.state.pairing.expiresAt - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  label.textContent = remaining ? `Code expires in ${minutes}:${String(seconds).padStart(2, '0')}` : 'Code expired';
}

function showCodeEntry(device) {
  openModal(`
    <div class="modal-head"><div><h2>Pair with ${escapeHtml(device.name)}</h2><p>Open OrbitSend on that computer and choose “Pair a device.”</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-body">
      <div class="device-detail"><div class="device-avatar">${deviceIcon(device.platform)}</div><div class="device-detail-copy"><strong>${escapeHtml(device.name)}</strong><span>${platformLabel(device.platform)} · ${escapeHtml(device.address || 'Nearby')}</span></div></div>
      <div class="field"><label for="pair-input">Six-digit code shown on ${escapeHtml(device.name)}</label><input class="code-input" id="pair-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></div>
      <div class="security-note">${icons.shield}<span>This one-time code authenticates an encrypted connection. You only need to pair once.</span></div>
    </div>
    <div class="modal-foot"><button class="button ghost" data-action="modal-close">Cancel</button><button class="button primary" data-action="pair-submit" data-id="${device.id}">Pair device</button></div>
  `);
  const input = document.getElementById('pair-input');
  input?.focus();
  input?.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
}

function showDeviceSettings(device) {
  openModal(`
    <div class="modal-head"><div><h2>Device settings</h2><p>Manage your secure connection with this computer.</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-body">
      <div class="device-detail"><div class="device-avatar">${deviceIcon(device.platform)}${device.online ? '<span class="online-dot"></span>' : ''}</div><div class="device-detail-copy"><strong>${escapeHtml(device.name)}</strong><span>${platformLabel(device.platform)} · ${device.online ? 'Online now' : 'Offline'}</span></div></div>
      <div class="setting-row"><div class="setting-copy"><strong>Trusted device</strong><span>Allow automatic file acceptance when the global setting is enabled.</span></div><label class="switch"><input type="checkbox" data-device-trust="${device.id}" ${device.trusted ? 'checked' : ''}><span></span></label></div>
      <div class="setting-row"><div class="setting-copy"><strong>Security fingerprint</strong><span class="fingerprint">${escapeHtml(device.fingerprint)}</span></div></div>
    </div>
    <div class="modal-foot"><button class="button danger" data-action="remove-device-confirm" data-id="${device.id}">Forget device</button><button class="button primary" data-action="modal-close">Done</button></div>
  `);
}

function showRemoveConfirm(device) {
  openModal(`
    <div class="modal-head"><div><h2>Forget ${escapeHtml(device.name)}?</h2><p>You’ll need to pair again before either computer can send anything.</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-foot"><button class="button ghost" data-action="modal-close">Cancel</button><button class="button danger" data-action="remove-device" data-id="${device.id}">Forget device</button></div>
  `);
}

function showIncomingModal(transfer) {
  if (modalRoot.firstElementChild) return;
  openModal(`
    <div class="modal-head"><div><h2>Incoming transfer</h2><p>${escapeHtml(transfer.peerName)} wants to send something to this computer.</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-body">
      <div class="device-detail"><div class="transfer-icon">${fileIcon(transfer.kind)}</div><div class="device-detail-copy"><strong>${escapeHtml(transfer.summary)}</strong><span>${formatBytes(transfer.totalBytes)} · ${escapeHtml(transfer.itemNames.join(', '))}</span></div></div>
      <div class="security-note">${icons.lock}<span>The transfer is encrypted and will be verified before it appears in your OrbitSend folder.</span></div>
    </div>
    <div class="modal-foot"><button class="button ghost" data-action="reject-transfer" data-id="${transfer.id}">Decline</button><button class="button primary" data-action="accept-transfer" data-id="${transfer.id}">Accept</button></div>
  `);
}

function showUpdateModal() {
  const update = ui.state?.updates;
  if (!update || update.status !== 'available') return;
  const notes = update.releaseNotes.trim() || 'This update contains improvements and fixes.';
  openModal(`
    <div class="modal-head"><div><span class="eyebrow">New version</span><h2>OrbitSend ${escapeHtml(update.latestVersion)}</h2><p>You’re currently using version ${escapeHtml(update.currentVersion)}.</p></div><button class="modal-close" data-action="modal-close">×</button></div>
    <div class="modal-body">
      <div class="update-hero"><div class="update-hero-icon">↻</div><div><strong>Ready to update</strong><span>${escapeHtml(update.assetName || 'Installer available')}</span></div></div>
      <div class="update-notes">${escapeHtml(notes).replaceAll('\n', '<br>')}</div>
      <div class="security-note">${icons.shield}<span>The installer is downloaded from the public OrbitSend update channel. Your pairing and settings remain on this computer.</span></div>
    </div>
    <div class="modal-foot"><button class="button ghost" data-action="modal-close">Later</button><button class="button primary" data-action="update-download">Download update</button></div>
  `);
}

function showToast({ tone = '', title, message, duration = 5000 }) {
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  const marks = { success: '✓', danger: '!', warning: '!', '': '•' };
  toast.innerHTML = `<div class="toast-mark">${marks[tone] || '•'}</div><div class="toast-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div><button class="toast-close">×</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), duration);
}

async function sendSelectedPaths(paths) {
  const device = selectedDevice();
  if (!device) throw new Error('Choose an online paired device first.');
  if (!paths.length) return;
  await window.orbit.sendPaths(device.id, paths);
  showToast({ tone: 'success', title: 'Transfer requested', message: `${paths.length === 1 ? 'Item' : 'Items'} ready to send to ${device.name}.` });
}

async function action(button) {
  const name = button.dataset.action;
  if (!name) return;
  if (name === 'modal-close') return closeModal();
  if (name === 'go-send') { ui.view = 'home'; closeModal(); return render(); }
  if (name === 'toggle-receiving') return window.orbit.updateSettings({ receivingEnabled: !ui.state.settings.receivingEnabled });
  if (name === 'pair-open') return showPairingModal();
  if (name === 'manual-connect-open') return showManualConnect();
  if (name === 'stop-pairing') { await window.orbit.stopPairing(); closeModal(); return; }
  if (name === 'pair-device') {
    const device = ui.state.devices.find((item) => item.id === button.dataset.id);
    if (device) showCodeEntry(device);
    return;
  }
  if (name === 'pair-submit') {
    const code = document.getElementById('pair-input')?.value || '';
    button.disabled = true;
    button.textContent = 'Pairing…';
    await window.orbit.pairDevice(button.dataset.id, code);
    closeModal();
    return;
  }
  if (name === 'manual-probe') {
    const address = document.getElementById('manual-address')?.value;
    if (!address) throw new Error('Enter the IP address shown on the other computer.');
    button.disabled = true;
    button.textContent = 'Searching…';
    const found = await window.orbit.probeDevice(address);
    ui.state = await window.orbit.getState();
    const device = ui.state.devices.find((item) => item.id === found.id);
    if (device) showCodeEntry(device);
    return;
  }
  if (name === 'select-device') {
    const device = ui.state.devices.find((item) => item.id === button.dataset.id);
    if (device?.online && device.paired) { ui.selectedDeviceId = device.id; renderHome(); }
    else if (device && !device.online) showToast({ tone: 'warning', title: 'Device is offline', message: 'Open OrbitSend on that computer and check the Wi‑Fi connection.' });
    return;
  }
  if (name === 'device-settings') {
    const device = ui.state.devices.find((item) => item.id === button.dataset.id);
    if (device) showDeviceSettings(device);
    return;
  }
  if (name === 'remove-device-confirm') {
    const device = ui.state.devices.find((item) => item.id === button.dataset.id);
    if (device) showRemoveConfirm(device);
    return;
  }
  if (name === 'remove-device') {
    await window.orbit.removeDevice(button.dataset.id);
    if (ui.selectedDeviceId === button.dataset.id) ui.selectedDeviceId = null;
    closeModal();
    return;
  }
  if (name === 'choose-files') return sendSelectedPaths(await window.orbit.pickFiles());
  if (name === 'choose-folder') return sendSelectedPaths(await window.orbit.pickFolder());
  if (name === 'compose-kind') {
    ui.composeKind = button.dataset.kind;
    renderHome();
    document.getElementById('compose-value')?.focus();
    return;
  }
  if (name === 'paste-clipboard') {
    ui.composeValue = await window.orbit.readClipboard();
    if (/^https?:\/\//i.test(ui.composeValue.trim())) ui.composeKind = 'link';
    renderHome();
    return;
  }
  if (name === 'send-text') {
    const device = selectedDevice();
    if (!device) throw new Error('Choose a device first.');
    const value = document.getElementById('compose-value')?.value || ui.composeValue;
    await window.orbit.sendText(device.id, value, ui.composeKind);
    ui.composeValue = '';
    renderHome();
    return;
  }
  if (name === 'accept-transfer') {
    await window.orbit.respondTransfer(button.dataset.id, true);
    closeModal();
    return;
  }
  if (name === 'reject-transfer') {
    await window.orbit.respondTransfer(button.dataset.id, false);
    closeModal();
    return;
  }
  if (name === 'cancel-transfer') return window.orbit.cancelTransfer(button.dataset.id);
  if (name === 'history-filter') { ui.historyFilter = button.dataset.filter; return renderHistory(); }
  if (name === 'clear-history') {
    openModal(`<div class="modal-head"><div><h2>Clear transfer history?</h2><p>This removes the activity list only. Received files are not deleted.</p></div><button class="modal-close" data-action="modal-close">×</button></div><div class="modal-foot"><button class="button ghost" data-action="modal-close">Cancel</button><button class="button danger" data-action="clear-history-confirm">Clear history</button></div>`);
    return;
  }
  if (name === 'clear-history-confirm') { await window.orbit.clearHistory(); closeModal(); return; }
  if (name === 'update-open') return showUpdateModal();
  if (name === 'update-check') {
    button.disabled = true;
    button.textContent = 'Checking…';
    const result = await window.orbit.checkForUpdates();
    ui.state.updates = result;
    render();
    if (result.status === 'available') showUpdateModal();
    else if (result.status === 'current') showToast({ tone: 'success', title: 'OrbitSend is up to date', message: `Version ${result.currentVersion} is the latest version.` });
    else if (result.error) throw new Error(result.error);
    return;
  }
  if (name === 'update-download') {
    button.disabled = true;
    button.textContent = 'Opening download…';
    await window.orbit.downloadUpdate();
    closeModal();
    showToast({ tone: 'success', title: 'Download opened', message: 'Install the new version over OrbitSend when the download finishes.' });
    return;
  }
  if (name === 'choose-download') {
    const downloadPath = await window.orbit.pickDownloadFolder();
    if (downloadPath) await window.orbit.updateSettings({ downloadPath });
    return;
  }
  if (name === 'reveal-download') return window.orbit.reveal(ui.state.settings.downloadPath);
  if (name === 'history-open-link') {
    const entry = ui.state.history.find((item) => item.id === button.dataset.id);
    if (entry) return window.orbit.openLink(entry.content);
  }
  if (name === 'history-copy') {
    const entry = ui.state.history.find((item) => item.id === button.dataset.id);
    if (entry) {
      await window.orbit.writeClipboard(entry.content);
      showToast({ tone: 'success', title: 'Copied', message: 'The received content is on your clipboard.' });
    }
  }
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-view]');
  if (nav) {
    ui.view = nav.dataset.view;
    render();
    mainView.scrollTop = 0;
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  action(button).catch((error) => {
    button.disabled = false;
    showToast({ tone: 'danger', title: 'Couldn’t complete that', message: error.message });
  });
});

document.addEventListener('change', (event) => {
  const setting = event.target.dataset.setting;
  if (setting) {
    window.orbit.updateSettings({ [setting]: event.target.checked }).catch((error) => showToast({ tone: 'danger', title: 'Setting not saved', message: error.message }));
    return;
  }
  const textSetting = event.target.dataset.settingText;
  if (textSetting) {
    window.orbit.updateSettings({ [textSetting]: event.target.value }).catch((error) => showToast({ tone: 'danger', title: 'Setting not saved', message: error.message }));
    return;
  }
  const peerId = event.target.dataset.deviceTrust;
  if (peerId) {
    window.orbit.updateDevice(peerId, { trusted: event.target.checked }).catch((error) => showToast({ tone: 'danger', title: 'Device not updated', message: error.message }));
  }
});

modalRoot.addEventListener('click', (event) => {
  if (event.target.classList.contains('modal-backdrop')) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.firstElementChild) closeModal();
  if (event.key === 'Enter' && event.target.id === 'pair-input') {
    document.querySelector('[data-action="pair-submit"]')?.click();
  }
});

window.addEventListener('dragenter', (event) => {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  ui.dragDepth += 1;
  dropOverlay.hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  ui.dragDepth = Math.max(0, ui.dragDepth - 1);
  if (!ui.dragDepth) dropOverlay.hidden = true;
});
window.addEventListener('drop', async (event) => {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  ui.dragDepth = 0;
  dropOverlay.hidden = true;
  try {
    const paths = pathsFromDrop(event.dataTransfer);
    if (!paths.length) throw new Error('OrbitSend could not read the dropped item. Try Choose files instead.');
    await sendSelectedPaths(paths);
  } catch (error) {
    showToast({ tone: 'danger', title: 'Drop failed', message: error.message });
  }
});

window.orbit.onState((state) => {
  ui.state = state;
  render();
});
window.orbit.onToast(showToast);
window.orbit.onIncomingRequest(showIncomingModal);
window.orbit.onReceivedMessage((transfer) => {
  showToast({
    tone: 'success',
    title: transfer.kind === 'link' ? 'Link received' : 'Text received',
    message: `${transfer.peerName} sent something${ui.state?.settings.copyReceivedText ? ' — copied to clipboard' : ''}.`,
    duration: 7000,
  });
});
window.orbit.onProgress((transfer) => {
  if (!ui.state) return;
  const index = ui.state.transfers.findIndex((item) => item.id === transfer.id);
  if (index >= 0) ui.state.transfers[index] = transfer;
  if (ui.view === 'home') renderHome();
});

window.setInterval(updatePairExpiry, 1_000);

window.orbit.getState()
  .then((state) => {
    ui.state = state;
    render();
  })
  .catch((error) => {
    mainView.innerHTML = `<div class="empty-state"><div class="empty-state-icon">!</div><strong>OrbitSend could not start</strong><span>${escapeHtml(error.message)}</span></div>`;
  });
