'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash, randomInt, randomUUID } = require('node:crypto');
const {
  decryptBuffer,
  decryptJson,
  derivePairingKey,
  deriveSessionKey,
  encryptBuffer,
  encryptJson,
  publicFingerprint,
  secureCodeEquals,
} = require('./crypto');

const MAX_JSON_BODY = 2 * 1024 * 1024;
const CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_BODY = CHUNK_SIZE + 64;
const MAX_FILES = 10_000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const DEFAULT_TRANSFER_PORT = 53_318;

function cleanRelativePath(input) {
  const raw = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = raw
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => {
      const clean = segment
        .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
        .replace(/[. ]+$/g, '')
        .slice(0, 180);
      return clean || 'untitled';
    });
  if (!segments.length) return 'untitled';
  return segments.join('/');
}

function humanKind(kind, count) {
  if (kind === 'folder') return count === 1 ? '1 folder' : `${count} files in a folder`;
  if (kind === 'files') return `${count} files`;
  if (kind === 'file') return '1 file';
  if (kind === 'link') return 'a link';
  if (kind === 'clipboard') return 'clipboard text';
  return 'a note';
}

async function readRequest(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('Request is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function safeErrorMessage(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return 'The other device did not respond.';
  }
  if (error?.code === 'ECONNREFUSED' || error?.cause?.code === 'ECONNREFUSED') {
    return 'The other device is offline or OrbitSend is blocked by its firewall.';
  }
  return error?.message || 'The transfer could not be completed.';
}

class TransferService extends EventEmitter {
  constructor(store, discovery) {
    super();
    this.store = store;
    this.discovery = discovery;
    this.server = null;
    this.port = null;
    this.pairing = null;
    this.pairAttempts = new Map();
    this.incoming = new Map();
    this.outgoing = new Map();
  }

  async start() {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        if (!res.headersSent) {
          sendJson(res, error.statusCode || 400, { error: safeErrorMessage(error) });
        } else {
          res.destroy();
        }
      });
    });
    this.server.requestTimeout = 60_000;
    this.server.headersTimeout = 15_000;
    const listen = (port) => new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(port, '0.0.0.0');
    });
    try {
      await listen(DEFAULT_TRANSFER_PORT);
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
      await listen(0);
    }
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  publicIdentity() {
    return this.store.publicIdentity(this.port);
  }

  startPairing() {
    this.pairing = {
      code: String(randomInt(100_000, 1_000_000)),
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
    this.emit('pairing', this.getPairingState());
    return this.getPairingState();
  }

  stopPairing() {
    this.pairing = null;
    this.emit('pairing', null);
  }

  getPairingState() {
    if (!this.pairing || this.pairing.expiresAt <= Date.now()) {
      this.pairing = null;
      return null;
    }
    return { ...this.pairing };
  }

  rateLimitPairing(address) {
    const now = Date.now();
    const attempts = (this.pairAttempts.get(address) || []).filter((time) => now - time < 60_000);
    if (attempts.length >= 8) {
      const error = new Error('Too many pairing attempts. Try again in a minute.');
      error.statusCode = 429;
      throw error;
    }
    attempts.push(now);
    this.pairAttempts.set(address, attempts);
  }

  async pairWithDevice(device, code) {
    if (!device?.id || !device.publicKey || !device.address || !device.port) {
      throw new Error('That device is no longer available.');
    }
    const local = this.publicIdentity();
    const normalizedCode = String(code || '').replace(/\D/g, '');
    if (normalizedCode.length !== 6) throw new Error('Enter the six-digit code shown on the other device.');
    const key = derivePairingKey(
      this.store.identity.privateKey,
      device.publicKey,
      local.id,
      device.id,
      normalizedCode,
    );
    const sender = {
      id: local.id,
      name: local.name,
      platform: local.platform,
      publicKey: local.publicKey,
      protocol: 1,
    };
    const envelope = encryptJson(
      { code: normalizedCode, sender, createdAt: Date.now() },
      key,
      `pair:${local.id}:${device.id}`,
    );
    const response = await fetch(`http://${device.address}:${device.port}/api/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sender, envelope }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Pairing was declined.');
    const accepted = decryptJson(
      body.envelope,
      key,
      `pair-response:${device.id}:${local.id}`,
    );
    if (
      !accepted.paired ||
      accepted.identity.id !== device.id ||
      accepted.identity.publicKey !== device.publicKey
    ) throw new Error('The device identity changed during pairing.');
    const peer = await this.store.savePeer(device);
    this.emit('paired', peer);
    return peer;
  }

  async handleRequest(req, res) {
    res.setHeader('connection', 'close');
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/v1/hello') {
      return sendJson(res, 200, this.publicIdentity());
    }
    if (!this.store.settings.receivingEnabled) {
      return sendJson(res, 503, { error: 'Receiving is paused on this device.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/pair') {
      return this.handlePairRequest(req, res);
    }
    if (req.method !== 'POST') return sendJson(res, 404, { error: 'Not found.' });

    const match = url.pathname.match(/^\/api\/v1\/transfers(?:\/([a-f0-9-]+)\/(status|chunk|complete|cancel))?$/i);
    if (!match) return sendJson(res, 404, { error: 'Not found.' });
    if (!match[1]) return this.handleTransferRequest(req, res, url.pathname);
    if (match[2] === 'status') return this.handleStatus(req, res, match[1], url.pathname);
    if (match[2] === 'chunk') return this.handleChunk(req, res, match[1]);
    if (match[2] === 'complete') return this.handleComplete(req, res, match[1], url.pathname);
    if (match[2] === 'cancel') return this.handleCancel(req, res, match[1], url.pathname);
    return sendJson(res, 404, { error: 'Not found.' });
  }

  async handlePairRequest(req, res) {
    const pairing = this.getPairingState();
    if (!pairing) return sendJson(res, 403, { error: 'Pairing mode is not active on this device.' });
    this.rateLimitPairing(req.socket.remoteAddress || 'unknown');
    const raw = await readRequest(req, MAX_JSON_BODY);
    const body = JSON.parse(raw.toString('utf8'));
    const sender = body.sender;
    if (!sender?.id || !sender.publicKey || sender.protocol !== 1) {
      return sendJson(res, 400, { error: 'Invalid pairing request.' });
    }
    const local = this.publicIdentity();
    let key;
    let payload;
    try {
      key = derivePairingKey(
        this.store.identity.privateKey,
        sender.publicKey,
        local.id,
        sender.id,
        pairing.code,
      );
      payload = decryptJson(body.envelope, key, `pair:${sender.id}:${local.id}`);
    } catch {
      return sendJson(res, 403, { error: 'The pairing code is incorrect.' });
    }
    if (!secureCodeEquals(payload.code, pairing.code) || payload.sender?.id !== sender.id) {
      return sendJson(res, 403, { error: 'The pairing code is incorrect.' });
    }
    const peer = await this.store.savePeer(sender);
    const envelope = encryptJson(
      { paired: true, identity: local, pairedAt: Date.now() },
      key,
      `pair-response:${local.id}:${sender.id}`,
    );
    this.stopPairing();
    this.emit('paired', peer);
    return sendJson(res, 200, { envelope });
  }

  getSession(senderId) {
    const peer = this.store.getPeer(senderId);
    if (!peer) {
      const error = new Error('This device is not paired.');
      error.statusCode = 403;
      throw error;
    }
    const key = deriveSessionKey(
      this.store.identity.privateKey,
      peer.publicKey,
      this.store.identity.id,
      peer.id,
    );
    return { peer, key };
  }

  async readSecureRequest(req, pathname, limit = MAX_JSON_BODY) {
    const senderId = String(req.headers['x-orbit-sender'] || '');
    const { peer, key } = this.getSession(senderId);
    const raw = await readRequest(req, limit);
    const envelope = JSON.parse(raw.toString('utf8'));
    const payload = decryptJson(envelope, key, `POST:${pathname}:${senderId}`);
    return { peer, key, payload };
  }

  sendSecureResponse(res, key, pathname, recipientId, value, statusCode = 200) {
    const envelope = encryptJson(
      value,
      key,
      `response:${pathname}:${this.store.identity.id}:${recipientId}`,
    );
    sendJson(res, statusCode, { envelope });
  }

  validateManifest(payload) {
    if (!payload?.transferId || !Array.isArray(payload.items) || payload.items.length > MAX_FILES) {
      throw new Error('Invalid transfer manifest.');
    }
    if (!['file', 'files', 'folder', 'link', 'text', 'clipboard'].includes(payload.kind)) {
      throw new Error('Unsupported transfer type.');
    }
    const items = payload.items.map((item) => ({
      name: cleanRelativePath(item.name).split('/').pop(),
      relativePath: cleanRelativePath(item.relativePath || item.name),
      size: Number(item.size),
      mime: String(item.mime || '').slice(0, 120),
    }));
    for (const item of items) {
      if (!Number.isSafeInteger(item.size) || item.size < 0) throw new Error('Invalid file size.');
    }
    const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    if (payload.kind === 'file' || payload.kind === 'files' || payload.kind === 'folder') {
      if (!items.length || totalBytes !== Number(payload.totalBytes)) {
        throw new Error('The transfer manifest does not match its contents.');
      }
    }
    return {
      transferId: String(payload.transferId),
      kind: payload.kind,
      items,
      totalBytes,
      content: String(payload.content || '').slice(0, 2_000_000),
      createdAt: Number(payload.createdAt) || Date.now(),
    };
  }

  async handleTransferRequest(req, res, pathname) {
    const { peer, key, payload } = await this.readSecureRequest(req, pathname);
    const manifest = this.validateManifest(payload);
    if (this.incoming.has(manifest.transferId)) {
      return this.sendSecureResponse(res, key, pathname, peer.id, {
        state: this.incoming.get(manifest.transferId).state,
      });
    }
    const isMessage = ['link', 'text', 'clipboard'].includes(manifest.kind);
    const transfer = {
      id: manifest.transferId,
      direction: 'incoming',
      peer,
      ...manifest,
      state: isMessage ? 'complete' : 'pending',
      receivedBytes: isMessage ? Buffer.byteLength(manifest.content) : 0,
      startedAt: Date.now(),
      files: [],
      destination: null,
      error: null,
    };
    this.incoming.set(transfer.id, transfer);
    await this.store.addHistory(this.historyEntry(transfer));

    if (isMessage) {
      await this.store.updateHistory(transfer.id, { status: 'complete', completedAt: new Date().toISOString() });
      this.emit('message', this.publicTransfer(transfer));
      this.emitTransfers();
    } else if (peer.trusted && this.store.settings.autoAcceptTrusted) {
      await this.acceptIncoming(transfer.id);
    } else {
      this.emit('incoming-request', this.publicTransfer(transfer));
      this.emitTransfers();
    }
    return this.sendSecureResponse(res, key, pathname, peer.id, { state: transfer.state }, 202);
  }

  async handleStatus(req, res, id, pathname) {
    const { peer, key } = await this.readSecureRequest(req, pathname);
    const transfer = this.incoming.get(id);
    if (!transfer || transfer.peer.id !== peer.id) {
      return this.sendSecureResponse(res, key, pathname, peer.id, { state: 'missing' }, 404);
    }
    return this.sendSecureResponse(res, key, pathname, peer.id, {
      state: transfer.state,
      offsets: transfer.files.map((file) => file.receivedBytes),
      error: transfer.error,
    });
  }

  async handleChunk(req, res, id) {
    const senderId = String(req.headers['x-orbit-sender'] || '');
    const { peer, key } = this.getSession(senderId);
    const transfer = this.incoming.get(id);
    if (!transfer || transfer.peer.id !== peer.id || !['accepted', 'receiving'].includes(transfer.state)) {
      return sendJson(res, 409, { error: 'The transfer is not ready to receive data.' });
    }
    const fileIndex = Number(req.headers['x-orbit-file']);
    const offset = Number(req.headers['x-orbit-offset']);
    const file = transfer.files[fileIndex];
    if (!file || !Number.isSafeInteger(offset) || offset !== file.receivedBytes) {
      return sendJson(res, 409, { error: 'The file offset does not match.', expectedOffset: file?.receivedBytes || 0 });
    }
    const ciphertext = await readRequest(req, MAX_CHUNK_BODY);
    let plaintext;
    try {
      plaintext = decryptBuffer(
        ciphertext,
        key,
        String(req.headers['x-orbit-nonce'] || ''),
        String(req.headers['x-orbit-tag'] || ''),
        `chunk:${id}:${fileIndex}:${offset}:${senderId}`,
      );
    } catch {
      return sendJson(res, 403, { error: 'Chunk authentication failed.' });
    }
    if (plaintext.length > CHUNK_SIZE || file.receivedBytes + plaintext.length > file.size) {
      return sendJson(res, 400, { error: 'Chunk exceeds the declared file size.' });
    }
    await fs.appendFile(file.partialPath, plaintext);
    file.hash.update(plaintext);
    file.receivedBytes += plaintext.length;
    transfer.receivedBytes += plaintext.length;
    transfer.state = 'receiving';
    this.emit('progress', this.publicTransfer(transfer));
    return sendJson(res, 200, { received: file.receivedBytes });
  }

  async handleComplete(req, res, id, pathname) {
    const { peer, key, payload } = await this.readSecureRequest(req, pathname);
    const transfer = this.incoming.get(id);
    if (!transfer || transfer.peer.id !== peer.id) {
      return this.sendSecureResponse(res, key, pathname, peer.id, { state: 'missing' }, 404);
    }
    const hashes = Array.isArray(payload.hashes) ? payload.hashes : [];
    for (let index = 0; index < transfer.files.length; index += 1) {
      const file = transfer.files[index];
      if (file.receivedBytes !== file.size) throw new Error(`“${file.name}” is incomplete.`);
      const digest = file.hash.digest('hex');
      if (hashes[index] !== digest) throw new Error(`“${file.name}” failed its integrity check.`);
    }
    for (const file of transfer.files) await fs.rename(file.partialPath, file.outputPath);
    transfer.state = 'complete';
    transfer.completedAt = Date.now();
    await this.store.updateHistory(transfer.id, {
      status: 'complete',
      completedAt: new Date().toISOString(),
      destination: transfer.destination,
    });
    this.emit('completed', this.publicTransfer(transfer));
    this.emitTransfers();
    return this.sendSecureResponse(res, key, pathname, peer.id, { state: 'complete' });
  }

  async handleCancel(req, res, id, pathname) {
    const { peer, key } = await this.readSecureRequest(req, pathname);
    const transfer = this.incoming.get(id);
    if (transfer && transfer.peer.id === peer.id) {
      transfer.state = 'canceled';
      await this.cleanupPartialFiles(transfer);
      await this.store.updateHistory(id, { status: 'canceled' });
      this.emitTransfers();
    }
    return this.sendSecureResponse(res, key, pathname, peer.id, { state: 'canceled' });
  }

  async acceptIncoming(id) {
    const transfer = this.incoming.get(id);
    if (!transfer || transfer.state !== 'pending') return null;
    transfer.destination = this.store.settings.downloadPath;
    await fs.mkdir(transfer.destination, { recursive: true });
    transfer.files = [];

    let folderRoot = null;
    if (transfer.kind === 'folder' && transfer.items.length) {
      const requestedRoot = transfer.items[0].relativePath.split('/')[0];
      folderRoot = await this.uniquePath(path.join(transfer.destination, requestedRoot), true);
      await fs.mkdir(folderRoot, { recursive: true });
    }

    for (const item of transfer.items) {
      let outputPath;
      if (folderRoot) {
        const rest = item.relativePath.split('/').slice(1);
        outputPath = path.join(folderRoot, ...rest);
      } else {
        outputPath = await this.uniquePath(path.join(transfer.destination, item.relativePath), false);
      }
      const relative = path.relative(transfer.destination, outputPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe destination path.');
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      const partialPath = `${outputPath}.orbitsend-part-${transfer.id}`;
      await fs.writeFile(partialPath, Buffer.alloc(0), { flag: 'wx' });
      transfer.files.push({
        ...item,
        outputPath,
        partialPath,
        receivedBytes: 0,
        hash: createHash('sha256'),
      });
    }
    transfer.state = 'accepted';
    await this.store.updateHistory(id, { status: 'receiving', destination: transfer.destination });
    this.emitTransfers();
    return this.publicTransfer(transfer);
  }

  async rejectIncoming(id) {
    const transfer = this.incoming.get(id);
    if (!transfer || transfer.state !== 'pending') return null;
    transfer.state = 'rejected';
    await this.store.updateHistory(id, { status: 'rejected' });
    this.emitTransfers();
    return this.publicTransfer(transfer);
  }

  async cancelTransfer(id) {
    const outgoing = this.outgoing.get(id);
    if (outgoing && !['complete', 'failed', 'canceled'].includes(outgoing.state)) {
      outgoing.canceled = true;
      outgoing.state = 'canceled';
      await this.store.updateHistory(id, { status: 'canceled' });
      const device = this.resolveDevice(outgoing.peer.id);
      if (device) this.securePost(device, `/api/v1/transfers/${id}/cancel`, {}).catch(() => {});
      this.emitTransfers();
      return;
    }
    const incoming = this.incoming.get(id);
    if (incoming && !['complete', 'rejected', 'canceled'].includes(incoming.state)) {
      incoming.state = 'canceled';
      await this.cleanupPartialFiles(incoming);
      await this.store.updateHistory(id, { status: 'canceled' });
      this.emitTransfers();
    }
  }

  async cleanupPartialFiles(transfer) {
    for (const file of transfer.files || []) {
      if (file.partialPath) await fs.unlink(file.partialPath).catch(() => {});
    }
  }

  async uniquePath(requestedPath, directory) {
    const extension = directory ? '' : path.extname(requestedPath);
    const base = extension ? requestedPath.slice(0, -extension.length) : requestedPath;
    for (let number = 0; number < 10_000; number += 1) {
      const candidate = number === 0 ? requestedPath : `${base} (${number})${extension}`;
      try {
        await fs.access(candidate);
      } catch {
        return candidate;
      }
    }
    throw new Error('Could not create a unique file name.');
  }

  async preparePaths(inputPaths) {
    const files = [];
    const uniqueInputs = [...new Set(inputPaths.map((value) => path.resolve(value)))];
    const inputStats = await Promise.all(uniqueInputs.map((inputPath) => fs.lstat(inputPath)));
    const singleFolder = uniqueInputs.length === 1 && inputStats[0].isDirectory();
    const walk = async (absolutePath, relativePath) => {
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        const entries = await fs.readdir(absolutePath, { withFileTypes: true });
        if (!entries.length) return;
        for (const entry of entries) {
          await walk(path.join(absolutePath, entry.name), path.posix.join(relativePath, entry.name));
        }
        return;
      }
      if (!stat.isFile()) return;
      if (files.length >= MAX_FILES) throw new Error(`A transfer can contain at most ${MAX_FILES.toLocaleString()} files.`);
      files.push({
        sourcePath: absolutePath,
        name: path.basename(absolutePath),
        relativePath: cleanRelativePath(relativePath),
        size: stat.size,
        mime: '',
      });
    };

    for (const inputPath of uniqueInputs) {
      await walk(inputPath, path.basename(inputPath));
    }
    if (!files.length) throw new Error('No readable files were selected.');
    return { files, singleFolder };
  }

  async sendPaths(peerId, inputPaths) {
    const prepared = await this.preparePaths(inputPaths);
    const kind = prepared.singleFolder ? 'folder' : prepared.files.length > 1 ? 'files' : 'file';
    return this.queueOutgoing(peerId, {
      kind,
      files: prepared.files,
      content: '',
    });
  }

  async sendText(peerId, content, kind = 'text') {
    const value = String(content || '').trim();
    if (!value) throw new Error('There is nothing to send.');
    if (Buffer.byteLength(value, 'utf8') > 2_000_000) throw new Error('Text is limited to 2 MB.');
    const normalizedKind = ['link', 'clipboard'].includes(kind) ? kind : 'text';
    if (normalizedKind === 'link') {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS links can be sent.');
    }
    return this.queueOutgoing(peerId, { kind: normalizedKind, files: [], content: value });
  }

  async queueOutgoing(peerId, data) {
    const peer = this.store.getPeer(peerId);
    const device = this.resolveDevice(peerId);
    if (!peer) throw new Error('Pair with that device before sending.');
    if (!device) throw new Error('That device is offline. Make sure both computers are on the same Wi-Fi.');
    const id = randomUUID();
    const items = data.files.map((file) => ({
      name: file.name,
      relativePath: file.relativePath,
      size: file.size,
      mime: file.mime,
    }));
    const totalBytes = data.files.reduce((sum, file) => sum + file.size, 0);
    const transfer = {
      id,
      direction: 'outgoing',
      peer,
      kind: data.kind,
      items,
      files: data.files,
      content: data.content,
      totalBytes,
      sentBytes: 0,
      state: 'connecting',
      startedAt: Date.now(),
      canceled: false,
      error: null,
    };
    this.outgoing.set(id, transfer);
    await this.store.addHistory(this.historyEntry(transfer));
    this.emitTransfers();
    setImmediate(() => this.runOutgoing(transfer, device));
    return this.publicTransfer(transfer);
  }

  async runOutgoing(transfer, device) {
    try {
      const requestPayload = {
        transferId: transfer.id,
        kind: transfer.kind,
        items: transfer.items,
        totalBytes: transfer.totalBytes,
        content: transfer.content,
        createdAt: transfer.startedAt,
      };
      const requested = await this.securePost(device, '/api/v1/transfers', requestPayload);
      transfer.state = requested.state;
      this.emitTransfers();

      const isMessage = ['link', 'text', 'clipboard'].includes(transfer.kind);
      if (isMessage) {
        transfer.state = 'complete';
        await this.completeOutgoing(transfer);
        return;
      }

      const waitStarted = Date.now();
      let status = requested;
      while (status.state === 'pending') {
        if (transfer.canceled) return;
        if (Date.now() - waitStarted > MAX_WAIT_MS) throw new Error('The transfer request expired.');
        await new Promise((resolve) => setTimeout(resolve, 650));
        status = await this.securePost(device, `/api/v1/transfers/${transfer.id}/status`, {});
        transfer.state = status.state;
        this.emitTransfers();
      }
      if (status.state === 'rejected') throw Object.assign(new Error('The other device declined the transfer.'), { rejected: true });
      if (!['accepted', 'receiving'].includes(status.state)) throw new Error(status.error || 'The other device cannot receive this transfer.');

      transfer.state = 'sending';
      const hashes = [];
      for (let index = 0; index < transfer.files.length; index += 1) {
        const file = transfer.files[index];
        const hash = createHash('sha256');
        const handle = await fs.open(file.sourcePath, 'r');
        let offset = Number(status.offsets?.[index] || 0);
        try {
          if (offset > 0) {
            const replay = Buffer.alloc(Math.min(CHUNK_SIZE, offset));
            let hashed = 0;
            while (hashed < offset) {
              const length = Math.min(replay.length, offset - hashed);
              const { bytesRead } = await handle.read(replay, 0, length, hashed);
              if (!bytesRead) break;
              hash.update(replay.subarray(0, bytesRead));
              hashed += bytesRead;
            }
          }
          while (offset < file.size) {
            if (transfer.canceled) return;
            const size = Math.min(CHUNK_SIZE, file.size - offset);
            const buffer = Buffer.allocUnsafe(size);
            const { bytesRead } = await handle.read(buffer, 0, size, offset);
            if (!bytesRead) throw new Error(`“${file.name}” changed while it was being sent.`);
            const chunk = buffer.subarray(0, bytesRead);
            hash.update(chunk);
            await this.sendChunk(device, transfer.id, index, offset, chunk);
            offset += bytesRead;
            transfer.sentBytes += bytesRead;
            this.emit('progress', this.publicTransfer(transfer));
          }
        } finally {
          await handle.close();
        }
        hashes.push(hash.digest('hex'));
      }
      await this.securePost(device, `/api/v1/transfers/${transfer.id}/complete`, { hashes });
      transfer.state = 'complete';
      await this.completeOutgoing(transfer);
    } catch (error) {
      transfer.state = error.rejected ? 'rejected' : transfer.canceled ? 'canceled' : 'failed';
      transfer.error = safeErrorMessage(error);
      await this.store.updateHistory(transfer.id, { status: transfer.state, error: transfer.error });
      this.emit('failed', this.publicTransfer(transfer));
      this.emitTransfers();
    }
  }

  async completeOutgoing(transfer) {
    transfer.completedAt = Date.now();
    await this.store.updateHistory(transfer.id, {
      status: 'complete',
      completedAt: new Date().toISOString(),
    });
    this.emit('completed', this.publicTransfer(transfer));
    this.emitTransfers();
  }

  resolveDevice(peerId) {
    const online = this.discovery.get(peerId);
    const peer = this.store.getPeer(peerId);
    return online && peer ? { ...peer, ...online, publicKey: peer.publicKey } : null;
  }

  async securePost(device, pathname, payload) {
    const localId = this.store.identity.id;
    const key = deriveSessionKey(
      this.store.identity.privateKey,
      device.publicKey,
      localId,
      device.id,
    );
    const envelope = encryptJson(payload, key, `POST:${pathname}:${localId}`);
    const response = await fetch(`http://${device.address}:${device.port}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-orbit-sender': localId,
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(65_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!body.envelope) throw new Error(body.error || `The other device returned error ${response.status}.`);
    const value = decryptJson(
      body.envelope,
      key,
      `response:${pathname}:${device.id}:${localId}`,
    );
    if (!response.ok) throw new Error(value.error || `The other device returned error ${response.status}.`);
    return value;
  }

  async sendChunk(device, transferId, fileIndex, offset, plaintext) {
    const localId = this.store.identity.id;
    const key = deriveSessionKey(
      this.store.identity.privateKey,
      device.publicKey,
      localId,
      device.id,
    );
    const encrypted = encryptBuffer(
      plaintext,
      key,
      `chunk:${transferId}:${fileIndex}:${offset}:${localId}`,
    );
    const response = await fetch(
      `http://${device.address}:${device.port}/api/v1/transfers/${transferId}/chunk`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-orbit-sender': localId,
          'x-orbit-file': String(fileIndex),
          'x-orbit-offset': String(offset),
          'x-orbit-nonce': encrypted.nonce,
          'x-orbit-tag': encrypted.tag,
        },
        body: encrypted.ciphertext,
        signal: AbortSignal.timeout(65_000),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'A file chunk could not be delivered.');
    }
  }

  historyEntry(transfer) {
    return {
      id: transfer.id,
      direction: transfer.direction,
      peerId: transfer.peer.id,
      peerName: transfer.peer.name,
      peerPlatform: transfer.peer.platform,
      kind: transfer.kind,
      summary: humanKind(transfer.kind, transfer.items.length),
      itemNames: transfer.items.slice(0, 4).map((item) => item.relativePath),
      totalBytes: transfer.totalBytes,
      content: ['link', 'text', 'clipboard'].includes(transfer.kind) ? transfer.content.slice(0, 2_000) : '',
      status: transfer.state,
      createdAt: new Date(transfer.startedAt).toISOString(),
      error: null,
    };
  }

  publicTransfer(transfer) {
    const currentBytes = transfer.direction === 'incoming' ? transfer.receivedBytes : transfer.sentBytes;
    return {
      id: transfer.id,
      direction: transfer.direction,
      peerId: transfer.peer.id,
      peerName: transfer.peer.name,
      peerPlatform: transfer.peer.platform,
      kind: transfer.kind,
      summary: humanKind(transfer.kind, transfer.items.length),
      itemNames: transfer.items.slice(0, 4).map((item) => item.relativePath),
      totalBytes: transfer.totalBytes,
      currentBytes: currentBytes || 0,
      progress: transfer.totalBytes ? Math.min(1, (currentBytes || 0) / transfer.totalBytes) : transfer.state === 'complete' ? 1 : 0,
      state: transfer.state,
      content: ['link', 'text', 'clipboard'].includes(transfer.kind) ? transfer.content : '',
      destination: transfer.destination,
      error: transfer.error,
      startedAt: transfer.startedAt,
    };
  }

  activeTransfers() {
    return [
      ...[...this.incoming.values()].map((transfer) => this.publicTransfer(transfer)),
      ...[...this.outgoing.values()].map((transfer) => this.publicTransfer(transfer)),
    ]
      .filter((transfer) => !['complete', 'failed', 'rejected', 'canceled'].includes(transfer.state) || Date.now() - transfer.startedAt < 30_000)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  emitTransfers() {
    this.emit('transfers', this.activeTransfers());
  }
}

module.exports = {
  CHUNK_SIZE,
  TransferService,
  cleanRelativePath,
};
