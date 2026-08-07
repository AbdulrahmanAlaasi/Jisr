'use strict';

const { EventEmitter } = require('node:events');

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

class UpdateService extends EventEmitter {
  constructor(options) {
    super();
    this.currentVersion = options.currentVersion;
    this.platform = options.platform || process.platform;
    this.arch = options.arch || process.arch;
    this.isEnabled = options.isEnabled || (() => true);
    this.fetcher = options.fetcher || fetch;
    this.checkPromise = null;
    this.state = {
      status: 'idle',
      currentVersion: this.currentVersion,
      latestVersion: null,
      releaseName: null,
      releaseNotes: '',
      releaseUrl: RELEASES_URL,
      downloadUrl: null,
      assetName: null,
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
}

module.exports = {
  LATEST_RELEASE_API,
  RELEASES_URL,
  UpdateService,
  compareVersions,
  parseVersion,
  selectReleaseAsset,
};
