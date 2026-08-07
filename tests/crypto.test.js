'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createIdentityKeyMaterial,
  decryptBuffer,
  decryptJson,
  derivePairingKey,
  deriveSessionKey,
  encryptBuffer,
  encryptJson,
  publicFingerprint,
} = require('../src/main/crypto');

test('paired devices derive the same persistent session key', () => {
  const alice = createIdentityKeyMaterial();
  const bob = createIdentityKeyMaterial();
  const aliceKey = deriveSessionKey(alice.privateKey, bob.publicKey, 'alice', 'bob');
  const bobKey = deriveSessionKey(bob.privateKey, alice.publicKey, 'bob', 'alice');
  assert.deepEqual(aliceKey, bobKey);
  assert.equal(aliceKey.length, 32);
});

test('pairing codes are mixed into the key exchange', () => {
  const alice = createIdentityKeyMaterial();
  const bob = createIdentityKeyMaterial();
  const correct = derivePairingKey(alice.privateKey, bob.publicKey, 'alice', 'bob', '123456');
  const reciprocal = derivePairingKey(bob.privateKey, alice.publicKey, 'bob', 'alice', '123456');
  const incorrect = derivePairingKey(bob.privateKey, alice.publicKey, 'bob', 'alice', '654321');
  assert.deepEqual(correct, reciprocal);
  assert.notDeepEqual(correct, incorrect);
});

test('JSON envelopes authenticate metadata and content', () => {
  const alice = createIdentityKeyMaterial();
  const bob = createIdentityKeyMaterial();
  const key = deriveSessionKey(alice.privateKey, bob.publicKey, 'alice', 'bob');
  const envelope = encryptJson({ message: 'hello', count: 3 }, key, 'request-context');
  assert.deepEqual(decryptJson(envelope, key, 'request-context'), { message: 'hello', count: 3 });
  assert.throws(() => decryptJson(envelope, key, 'other-context'));
});

test('encrypted file chunks detect tampering', () => {
  const alice = createIdentityKeyMaterial();
  const bob = createIdentityKeyMaterial();
  const key = deriveSessionKey(alice.privateKey, bob.publicKey, 'alice', 'bob');
  const envelope = encryptBuffer(Buffer.from('private file contents'), key, 'chunk:1');
  const damaged = Buffer.from(envelope.ciphertext);
  damaged[0] ^= 1;
  assert.throws(() => decryptBuffer(damaged, key, envelope.nonce, envelope.tag, 'chunk:1'));
});

test('fingerprints are compact and stable', () => {
  const identity = createIdentityKeyMaterial();
  const fingerprint = publicFingerprint(identity.publicKey);
  assert.match(fingerprint, /^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/);
  assert.equal(fingerprint, publicFingerprint(identity.publicKey));
});
