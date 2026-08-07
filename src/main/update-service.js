'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');

const UPDATE_OWNER = 'AbdulrahmanAlaasi';
// Keep the legacy repository until all installed OrbitSend builds have moved to Jisr.
const UPDATE_REPOSITORY = 'OrbitSend-Updates';
const RELEASES_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPOSITORY}/releases/latest`;

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function selectReleaseAsset(assets, platform, arch) {
  const list = Array.isArray(assets) ? assets : [];
  const candidates = list.filter((asset) => asset?.browser_download_url && asset?.name);
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return candidates.find((asset) => /arm64.*\.dmg$/i.test(asset.name)) || null;
    }
    return candidates.find((asset) => /\.dmg$/i.test(asset.name) && !/arm64/i.test(asset.name)) || null;
  }
  if (platform === 'win32') {
    return candidates.find((asset) => /setup.*\.exe$/i.test(asset.name)) ||
      candidates.find((asset) => /\.exe$/i.test(asset.name)) || null;
  }
  return null;
}

function parseAssetDigest(value) {
  const match = String(value || '').trim().match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
}

function isTrustedUpdateUrl(value) {
  try {
    const url = new URL(value);
    const expectedPrefixes = [
      '/AbdulrahmanAlaasi/OrbitSend-Updates/releases/',
      '/AbdulrahmanAlaasi/Jisr-Updates/releases/',
      '/AbdulrahmanAlaasi/Jisr/releases/',
    ];
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      expectedPrefixes.some((prefix) => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

class UpdateService extends EventEmitter {
  constructor(options) {
    super();
    this.currentVersion = options.currentVersion;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.isEnabled = options.isEnabled || (() => true);
    this.fetcher = options.fetcher || fetch;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.downloadedPath = null;
    this.state = {
      status: 'idle',
      currentVersion: this.currentVersion,
      latestVersion: null,
      releaseName: null,
      releaseNotes: '',
      releaseUrl: RELEASES_URL,
      downloadUrl: null,
      assetName: null,
      assetDigest: null,
      assetSize: 0,
      downloadBytes: 0,
      downloadPercent: 0,
      checkedAt: null,
      error: null,
    };
  }

  publicState() {
    return { ...this.state };
  }

  setState(changes) {
    this.state = { ...this.state, ...changes };
    this.emit('state', this.publicState());
    return this.publicState();
  }

  async check(options = {}) {
    if (!options.manual && !this.isEnabled()) {
      return this.setState({ status: 'disabled', error: null });
    }
    if (this.checkPromise) return this.checkPromise;
    if (['downloading', 'downloaded', 'installing'].includes(this.state.status)) {
      return this.publicState();
    }
    this.checkPromise = this.performCheck(options).finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async performCheck(options) {
    this.setState({ status: 'checking', error: null });
    try {
      const response = await this.fetcher(LATEST_RELEASE_API, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': `Jisr/${this.currentVersion}`,
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) {
        return this.setState({
          status: 'current',
          latestVersion: this.currentVersion,
          checkedAt: new Date().toISOString(),
          error: null,
        });
      }
      if (!response.ok) throw new Error(`Update service returned ${response.status}.`);
      const release = await response.json();
      const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
      if (!parseVersion(latestVersion)) throw new Error('The latest release has an invalid version.');
      const available = compareVersions(latestVersion, this.currentVersion) > 0;
      const asset = selectReleaseAsset(release.assets, this.platform, this.arch);
      return this.setState({
        status: available ? 'available' : 'current',
        latestVersion,
        releaseName: String(release.name || `Jisr ${latestVersion}`).slice(0, 160),
        releaseNotes: String(release.body || '').slice(0, 8_000),
        releaseUrl: release.html_url || RELEASES_URL,
        downloadUrl: asset?.browser_download_url || release.html_url || RELEASES_URL,
        assetName: asset?.name || null,
        assetDigest: parseAssetDigest(asset?.digest),
        assetSize: Number(asset?.size || 0),
        downloadBytes: 0,
        downloadPercent: 0,
        checkedAt: new Date().toISOString(),
        error: null,
      });
    } catch (error) {
      const message = error?.name === 'TimeoutError'
        ? 'The update service did not respond.'
        : error?.message || 'Could not check for updates.';
      return this.setState({
        status: options.manual ? 'error' : 'idle',
        checkedAt: new Date().toISOString(),
        error: message,
      });
    }
  }

  async download(destinationDirectory) {
    if (this.downloadPromise) return this.downloadPromise;
    if (this.state.status === 'downloaded' && this.downloadedPath) return this.publicState();
    if (this.state.status !== 'available' || !this.state.downloadUrl || !this.state.assetName) {
      throw new Error('No update is currently available.');
    }
    if (!isTrustedUpdateUrl(this.state.downloadUrl)) {
      throw new Error('The update download address could not be verified.');
    }
    if (!this.state.assetDigest) {
      throw new Error('This update is missing its security checksum.');
    }

    this.downloadPromise = this.performDownload(destinationDirectory)
      .finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async performDownload(destinationDirectory) {
    const assetName = path.basename(this.state.assetName);
    const allowedExtension = this.platform === 'darwin' ? /\.dmg$/i : /\.exe$/i;
    if (assetName !== this.state.assetName || !allowedExtension.test(assetName)) {
      throw new Error('The update installer type is not supported.');
    }

    const directory = path.resolve(destinationDirectory);
    const finalPath = path.join(directory, assetName);
    const partialPath = `${finalPath}.part`;
    await fs.mkdir(directory, { recursive: true });
    await fs.rm(partialPath, { force: true });
    this.setState({ status: 'downloading', downloadBytes: 0, downloadPercent: 0, error: null });

    let file = null;
    try {
      const response = await this.fetcher(this.state.downloadUrl, {
        headers: {
          accept: 'application/octet-stream',
          'user-agent': `Jisr/${this.currentVersion}`,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      if (!response.ok || !response.body) {
        throw new Error(`The update download returned ${response.status}.`);
      }

      const expectedSize = this.state.assetSize || Number(response.headers?.get?.('content-length') || 0);
      const digest = crypto.createHash('sha256');
      const reader = response.body.getReader();
      let downloaded = 0;
      let lastProgressAt = 0;
      file = await fs.open(partialPath, 'w');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        await file.write(chunk);
        digest.update(chunk);
        downloaded += chunk.length;
        const now = Date.now();
        if (now - lastProgressAt >= 150) {
          const percent = expectedSize ? Math.min(99, (downloaded / expectedSize) * 100) : 0;
          this.setState({ downloadBytes: downloaded, downloadPercent: percent });
          lastProgressAt = now;
        }
      }

      await file.sync();
      await file.close();
      file = null;
      if (this.state.assetSize && downloaded !== this.state.assetSize) {
        throw new Error('The downloaded update is incomplete.');
      }
      if (digest.digest('hex') !== this.state.assetDigest) {
        throw new Error('The downloaded update did not pass its security check.');
      }

      await fs.rm(finalPath, { force: true });
      await fs.rename(partialPath, finalPath);
      this.downloadedPath = finalPath;
      return this.setState({
        status: 'downloaded',
        downloadBytes: downloaded,
        downloadPercent: 100,
        error: null,
      });
    } catch (error) {
      await file?.close().catch(() => {});
      await fs.rm(partialPath, { force: true });
      this.setState({ status: 'available', downloadBytes: 0, downloadPercent: 0, error: error.message });
      throw error;
    }
  }

  installerPath() {
    return this.state.status === 'downloaded' ? this.downloadedPath : null;
  }

  markInstalling() {
    if (!this.installerPath()) throw new Error('The update has not finished downloading.');
    return this.setState({ status: 'installing', error: null });
  }
}

module.exports = {
  LATEST_RELEASE_API,
  RELEASES_URL,
  UpdateService,
  compareVersions,
  isTrustedUpdateUrl,
  parseAssetDigest,
  parseVersion,
  selectReleaseAsset,
};
