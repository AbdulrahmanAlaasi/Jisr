'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createIdentityKeyMaterial, publicFingerprint } = require('./crypto');

const DEFAULT_SETTINGS = {
  deviceName: os.hostname().replace(/\.local$/i, '').slice(0, 40) || 'My computer',
  downloadPath: '',
  launchAtLogin: true,
  receivingEnabled: true,
  autoAcceptTrusted: false,
  copyReceivedText: true,
  showNotifications: true,
  soundEnabled: true,
  keepRunningInTray: true,
};

class OrbitStore {
  constructor(userDataPath, safeStorage, downloadsPath) {
    this.directory = userDataPath;
    this.safeStorage = safeStorage;
    this.downloadsPath = downloadsPath;
    this.identity = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.peers = [];
    this.history = [];
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    this.settings = {
      ...DEFAULT_SETTINGS,
      downloadPath: path.join(this.downloadsPath, 'OrbitSend'),
      ...(await this.readJson('settings.json', {})),
    };
    this.peers = await this.readJson('peers.json', []);
    this.history = await this.readJson('history.json', []);
    this.identity = await this.loadOrCreateIdentity();
    await fs.mkdir(this.settings.downloadPath, { recursive: true });
    return this;
  }

  async readJson(fileName, fallback) {
    try {
      const contents = await fs.readFile(path.join(this.directory, fileName), 'utf8');
      return JSON.parse(contents);
    } catch {
      return fallback;
    }
  }

  async writeJson(fileName, value) {
    const filePath = path.join(this.directory, fileName);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath).catch(async () => {
      await fs.copyFile(temporaryPath, filePath);
      await fs.unlink(temporaryPath).catch(() => {});
    });
  }

  async loadOrCreateIdentity() {
    const stored = await this.readJson('identity.json', null);
    if (stored) {
      try {
        let decoded;
        if (stored.protected && this.safeStorage?.isEncryptionAvailable()) {
          if (typeof this.safeStorage.decryptStringAsync === 'function') {
            decoded = await this.safeStorage.decryptStringAsync(
              Buffer.from(stored.data, 'base64'),
            );
          } else {
            decoded = this.safeStorage.decryptString(Buffer.from(stored.data, 'base64'));
          }
        } else {
          decoded = Buffer.from(stored.data, 'base64').toString('utf8');
        }
        const identity = JSON.parse(decoded);
        if (identity.id && identity.publicKey && identity.privateKey) return identity;
      } catch {
        // A damaged or machine-bound identity is safely replaced below.
      }
    }

    const keys = createIdentityKeyMaterial();
    const identity = {
      id: randomUUID(),
      ...keys,
      fingerprint: publicFingerprint(keys.publicKey),
      createdAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(identity);
    let protectedData = false;
    let data = Buffer.from(serialized, 'utf8');
    if (this.safeStorage?.isEncryptionAvailable()) {
      protectedData = true;
      if (typeof this.safeStorage.encryptStringAsync === 'function') {
        data = await this.safeStorage.encryptStringAsync(serialized);
      } else {
        data = this.safeStorage.encryptString(serialized);
      }
    }
    await this.writeJson('identity.json', {
      protected: protectedData,
      data: Buffer.from(data).toString('base64'),
    });
    return identity;
  }

  publicIdentity(port) {
    return {
      id: this.identity.id,
      name: this.settings.deviceName,
      platform: process.platform,
      publicKey: this.identity.publicKey,
      fingerprint: this.identity.fingerprint,
      port,
      protocol: 1,
    };
  }

  getPeer(id) {
    return this.peers.find((peer) => peer.id === id) || null;
  }

  async savePeer(peer) {
    const existingIndex = this.peers.findIndex((item) => item.id === peer.id);
    const normalized = {
      ...(existingIndex >= 0 ? this.peers[existingIndex] : {}),
      id: peer.id,
      name: String(peer.name || 'Unknown device').slice(0, 80),
      platform: peer.platform === 'darwin' ? 'darwin' : peer.platform === 'win32' ? 'win32' : 'other',
      publicKey: peer.publicKey,
      fingerprint: publicFingerprint(peer.publicKey),
      trusted: typeof peer.trusted === 'boolean'
        ? peer.trusted
        : existingIndex >= 0
          ? Boolean(this.peers[existingIndex]?.trusted)
          : false,
      pairedAt: existingIndex >= 0 ? this.peers[existingIndex].pairedAt : new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    if (existingIndex >= 0) this.peers[existingIndex] = normalized;
    else this.peers.push(normalized);
    await this.writeJson('peers.json', this.peers);
    return normalized;
  }

  async updatePeer(id, changes) {
    const peer = this.getPeer(id);
    if (!peer) return null;
    if (typeof changes.trusted === 'boolean') peer.trusted = changes.trusted;
    if (typeof changes.name === 'string' && changes.name.trim()) {
      peer.name = changes.name.trim().slice(0, 80);
    }
    await this.writeJson('peers.json', this.peers);
    return peer;
  }

  async removePeer(id) {
    const before = this.peers.length;
    this.peers = this.peers.filter((peer) => peer.id !== id);
    if (this.peers.length !== before) await this.writeJson('peers.json', this.peers);
  }

  async updateSettings(changes) {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    for (const key of allowed) {
      if (!(key in changes)) continue;
      if (key === 'deviceName') {
        const name = String(changes[key]).trim();
        if (name) this.settings[key] = name.slice(0, 40);
      } else if (key === 'downloadPath') {
        this.settings[key] = String(changes[key]);
      } else {
        this.settings[key] = Boolean(changes[key]);
      }
    }
    await fs.mkdir(this.settings.downloadPath, { recursive: true });
    await this.writeJson('settings.json', this.settings);
    return this.settings;
  }

  async addHistory(entry) {
    this.history.unshift({ ...entry });
    this.history = this.history.slice(0, 200);
    await this.writeJson('history.json', this.history);
  }

  async updateHistory(id, changes) {
    const entry = this.history.find((item) => item.id === id);
    if (!entry) return;
    Object.assign(entry, changes);
    await this.writeJson('history.json', this.history);
  }

  async clearHistory() {
    this.history = [];
    await this.writeJson('history.json', this.history);
  }
}

module.exports = { OrbitStore };
