'use strict';

const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} = require('node:crypto');

// Retained for wire compatibility with paired OrbitSend 0.3.x devices.
const PROTOCOL_INFO = Buffer.from('OrbitSend secure channel v1', 'utf8');

function createIdentityKeyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

function publicFingerprint(publicKey) {
  const compact = createHash('sha256')
    .update(Buffer.from(publicKey, 'base64'))
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return compact.match(/.{1,4}/g).join('-');
}

function deriveSharedSecret(privateKey, peerPublicKey) {
  return diffieHellman({
    privateKey: createPrivateKey({
      key: Buffer.from(privateKey, 'base64'),
      type: 'pkcs8',
      format: 'der',
    }),
    publicKey: createPublicKey({
      key: Buffer.from(peerPublicKey, 'base64'),
      type: 'spki',
      format: 'der',
    }),
  });
}

function orderedIds(localId, peerId) {
  return [localId, peerId].sort().join(':');
}

function deriveSessionKey(privateKey, peerPublicKey, localId, peerId) {
  const secret = deriveSharedSecret(privateKey, peerPublicKey);
  const salt = createHash('sha256')
    .update(`session:${orderedIds(localId, peerId)}`)
    .digest();
  return Buffer.from(hkdfSync('sha256', secret, salt, PROTOCOL_INFO, 32));
}

function derivePairingKey(privateKey, peerPublicKey, localId, peerId, code) {
  const secret = deriveSharedSecret(privateKey, peerPublicKey);
  const normalizedCode = String(code || '').replace(/\D/g, '');
  const salt = createHash('sha256')
    .update(`pair:${orderedIds(localId, peerId)}:${normalizedCode}`)
    .digest();
  return Buffer.from(hkdfSync('sha256', secret, salt, PROTOCOL_INFO, 32));
}

function encryptBuffer(plaintext, key, additionalData = '') {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  if (additionalData) cipher.setAAD(Buffer.from(additionalData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext,
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decryptBuffer(ciphertext, key, nonce, tag, additionalData = '') {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(nonce, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  if (additionalData) decipher.setAAD(Buffer.from(additionalData, 'utf8'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptJson(value, key, additionalData = '') {
  const result = encryptBuffer(
    Buffer.from(JSON.stringify(value), 'utf8'),
    key,
    additionalData,
  );
  return {
    data: result.ciphertext.toString('base64'),
    nonce: result.nonce,
    tag: result.tag,
  };
}

function decryptJson(envelope, key, additionalData = '') {
  const plaintext = decryptBuffer(
    Buffer.from(envelope.data, 'base64'),
    key,
    envelope.nonce,
    envelope.tag,
    additionalData,
  );
  return JSON.parse(plaintext.toString('utf8'));
}

function secureCodeEquals(actual, expected) {
  const a = Buffer.from(String(actual || '').replace(/\D/g, ''));
  const b = Buffer.from(String(expected || '').replace(/\D/g, ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = {
  createIdentityKeyMaterial,
  decryptBuffer,
  decryptJson,
  derivePairingKey,
  deriveSessionKey,
  encryptBuffer,
  encryptJson,
  publicFingerprint,
  secureCodeEquals,
};
