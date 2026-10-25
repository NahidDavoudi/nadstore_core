import { describe, expect, it } from 'vitest';
import { createCryptoService, CryptoError, aadForColumn, safeEqual, sha256 } from './index.js';
import { randomBytesBuf } from './hash.js';

const AAD = 'tenants.db_password';

function makeService() {
  const key1 = randomBytesBuf(32);
  const key2 = randomBytesBuf(32);
  const keys = new Map<number, Buffer>([
    [1, key1],
    [2, key2],
  ]);
  return createCryptoService({ masterKeys: keys, currentVersion: 1 });
}

describe('crypto — AES-256-GCM (mandatory test row 4)', () => {
  it('round-trips plaintext with the same AAD', () => {
    const crypto = makeService();
    const plaintext = 'p@ssw0rd-فارسی-🔒-not-really';
    const { blob, keyVersion } = crypto.encrypt(plaintext, AAD);
    expect(keyVersion).toBe(1);
    expect(crypto.decryptText(blob, keyVersion, AAD)).toBe(plaintext);
  });

  it('round-trips Buffer input and produces unique IVs per encryption', () => {
    const crypto = makeService();
    const input = randomBytesBuf(64);
    const a = crypto.encrypt(input, AAD);
    const b = crypto.encrypt(input, AAD);
    expect(a.keyVersion).toBe(1);
    expect(b.keyVersion).toBe(1);
    expect(a.blob.equals(b.blob)).toBe(false);
    expect(crypto.decrypt(a.blob, 1, AAD).equals(input)).toBe(true);
  });

  it('rejects a tampered ciphertext byte', () => {
    const crypto = makeService();
    const { blob } = crypto.encrypt('secret password', AAD);
    const lastIdx = blob.length - 1;
    blob[lastIdx] = (blob[lastIdx] ?? 0) ^ 0x01;
    expect(() => crypto.decrypt(blob, 1, AAD)).toThrow(CryptoError);
  });

  it('rejects a tampered auth tag', () => {
    const crypto = makeService();
    const { blob } = crypto.encrypt('secret password', AAD);
    blob[0] = (blob[0] ?? 0) ^ 0xff; // first byte belongs to the IV — flips decryption entirely
    expect(() => crypto.decrypt(blob, 1, AAD)).toThrow(CryptoError);
    blob[0] = (blob[0] ?? 0) ^ 0xff; // restore IV, corrupt the tag instead
    blob[12] = (blob[12] ?? 0) ^ 0xff;
    expect(() => crypto.decrypt(blob, 1, AAD)).toThrow(CryptoError);
  });

  it('rejects decryption with the wrong AAD', () => {
    const crypto = makeService();
    const { blob } = crypto.encrypt('secret password', AAD);
    expect(() => crypto.decrypt(blob, 1, 'tenant_services.config')).toThrow(CryptoError);
  });

  it('rejects an unknown key version', () => {
    const crypto = makeService();
    const { blob } = crypto.encrypt('secret password', AAD);
    expect(() => crypto.decrypt(blob, 99, AAD)).toThrow(CryptoError);
  });

  it('rejects truncated blobs', () => {
    const crypto = makeService();
    expect(() => crypto.decrypt(Buffer.alloc(10), 1, AAD)).toThrow(CryptoError);
  });

  it('supports key rotation: old version still decrypts, new encryptions use the current version', () => {
    const key1 = randomBytesBuf(32);
    const key2 = randomBytesBuf(32);
    const keys = new Map<number, Buffer>([
      [1, key1],
      [2, key2],
    ]);
    const cryptoV1 = createCryptoService({ masterKeys: keys, currentVersion: 1 });
    const oldBlob = cryptoV1.encrypt('rotate-me', AAD);

    const cryptoV2 = createCryptoService({ masterKeys: keys, currentVersion: 2 });
    const reEncrypted = cryptoV2.encrypt(cryptoV1.decryptText(oldBlob.blob, 1, AAD), AAD);

    expect(reEncrypted.keyVersion).toBe(2);
    expect(cryptoV2.decryptText(reEncrypted.blob, 2, AAD)).toBe('rotate-me');
    // The old version must remain decryptable until secrets:rotate finishes.
    expect(cryptoV2.decryptText(oldBlob.blob, 1, AAD)).toBe('rotate-me');
  });

  it('validates AAD column identifiers', () => {
    expect(aadForColumn('tenants.db_password')).toBe('tenants.db_password');
    expect(() => aadForColumn('Bad AAD!')).toThrow(CryptoError);
  });
});

describe('crypto — hashing and constant-time comparison (mandatory test row 3 foundation)', () => {
  it('produces a 32-byte SHA-256 hash', () => {
    expect(sha256('nad_sk_abc').length).toBe(32);
    expect(sha256(Buffer.from('nad_sk_abc')).equals(sha256('nad_sk_abc'))).toBe(true);
  });

  it('safeEqual matches equal buffers and rejects different ones', () => {
    expect(safeEqual('same', 'same')).toBe(true);
    expect(safeEqual(Buffer.from('same'), Buffer.from('same'))).toBe(true);
    expect(safeEqual('same', 'sane')).toBe(false);
    expect(safeEqual('short', 'a-much-longer-value')).toBe(false);
  });
});
