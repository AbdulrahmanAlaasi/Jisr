'use strict';

const dgram = require('node:dgram');
const { EventEmitter } = require('node:events');

const DISCOVERY_PORT = 43891;
const MULTICAST_ADDRESS = '239.255.83.78';
const BEACON_INTERVAL = 2_000;
const OFFLINE_AFTER = 7_000;

class DeviceDiscovery extends EventEmitter {
  constructor(getIdentity, isVisible) {
    super();
    this.getIdentity = getIdentity;
    this.isVisible = isVisible;
    this.devices = new Map();
    this.socket = null;
    this.timer = null;
  }

  start() {
    if (this.socket) return;
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('message', (message, remote) => this.onMessage(message, remote));
    this.socket.on('error', (error) => this.emit('warning', error));
    this.socket.bind(DISCOVERY_PORT, () => {
      try {
        this.socket.addMembership(MULTICAST_ADDRESS);
        this.socket.setMulticastTTL(1);
        this.socket.setBroadcast(true);
      } catch (error) {
        this.emit('warning', error);
      }
      this.announce();
    });
    this.timer = setInterval(() => {
      this.announce();
      this.expireDevices();
    }, BEACON_INTERVAL);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.socket) this.socket.close();
    this.socket = null;
    this.devices.clear();
  }

  announce() {
    if (!this.socket || !this.isVisible()) return;
    const identity = this.getIdentity();
    if (!identity?.port) return;
    const packet = Buffer.from(
      // The legacy beacon name keeps Jisr discoverable by OrbitSend 0.3.x during migration.
      JSON.stringify({ type: 'ORBIT_HELLO', ...identity }),
      'utf8',
    );
    if (packet.length > 7_500) return;
    this.socket.send(packet, DISCOVERY_PORT, MULTICAST_ADDRESS, () => {});
    this.socket.send(packet, DISCOVERY_PORT, '255.255.255.255', () => {});
  }

  onMessage(message, remote) {
    if (message.length > 8_192) return;
    try {
      const beacon = JSON.parse(message.toString('utf8'));
      const local = this.getIdentity();
      if (
        beacon.type !== 'ORBIT_HELLO' ||
        beacon.protocol !== 1 ||
        !beacon.id ||
        beacon.id === local.id ||
        !beacon.publicKey ||
        !Number.isInteger(beacon.port) ||
        beacon.port < 1 ||
        beacon.port > 65_535
      ) return;
      const previous = this.devices.get(beacon.id);
      this.devices.set(beacon.id, {
        id: beacon.id,
        name: String(beacon.name || 'Unknown device').slice(0, 80),
        platform: beacon.platform,
        publicKey: beacon.publicKey,
        fingerprint: beacon.fingerprint,
        port: beacon.port,
        address: remote.address,
        lastSeen: Date.now(),
      });
      if (!previous || previous.address !== remote.address || previous.name !== beacon.name) {
        this.emitDevices();
      }
    } catch {
      // Ignore malformed or unrelated multicast traffic.
    }
  }

  expireDevices() {
    let changed = false;
    const now = Date.now();
    for (const [id, device] of this.devices) {
      if (now - device.lastSeen > OFFLINE_AFTER) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitDevices();
  }

  emitDevices() {
    this.emit('devices', this.list());
  }

  list() {
    return [...this.devices.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id) {
    return this.devices.get(id) || null;
  }

  async probe(host, port) {
    const cleanHost = String(host || '').trim().replace(/^https?:\/\//, '');
    const url = new URL(`http://${cleanHost}${port ? `:${port}` : ''}/api/v1/hello`);
    if (!url.port) url.port = '53318';
    const response = await fetch(url, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) throw new Error('No Jisr device answered at that address.');
    const device = await response.json();
    if (device.protocol !== 1 || !device.id || !device.publicKey) {
      throw new Error('That address is not a Jisr device.');
    }
    const normalized = {
      ...device,
      address: url.hostname,
      port: Number(device.port || url.port),
      lastSeen: Date.now(),
    };
    this.devices.set(device.id, normalized);
    this.emitDevices();
    return normalized;
  }
}

module.exports = { DeviceDiscovery, DISCOVERY_PORT };
