import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class CryptoError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

export interface EncryptedBlob {
  /** iv(12) || tag(16) || ciphertext — stored in VARBINARY columns. */
  readonly blob: Buffer;
  /** Version of the master key that produced this blob (column enc_key_version). */
  readonly keyVersion: number;
}

export interface CryptoKeys {
  /** All known master key versions (from MASTER_KEYS). */
  readonly masterKeys: ReadonlyMap<number, Buffer>;
  /** Version used for new encryptions (from MASTER_KEY_CURRENT). */
  readonly currentVersion: number;
}

export interface CryptoService {
  encrypt(plaintext: Buffer | string, aad: string): EncryptedBlob;
  decrypt(blob: Buffer, keyVersion: number, aad: string): Buffer;
  decryptText(blob: Buffer, keyVersion: number, aad: string): string;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(keys: CryptoKeys, version: number): Buffer {
  const key = keys.masterKeys.get(version);
  if (key === undefined) {
    throw new CryptoError(`unknown master key version ${version}`);
  }
  return key;
}

/**
 * AES-256-GCM with a random 12-byte IV per encryption and a per-column AAD
 * (architecture document, section 14). Wrong AAD, tampered tag/ciphertext or
 * an unknown key version must fail loudly — never return corrupted plaintext.
 */
export function createCryptoService(keys: CryptoKeys): CryptoService {
  return {
    encrypt(plaintext, aad) {
      if (keys.masterKeys.size === 0) {
        throw new CryptoError('no master keys configured');
      }
      const key = getKey(keys, keys.currentVersion);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return { blob: Buffer.concat([iv, tag, ciphertext]), keyVersion: keys.currentVersion };
    },

    decrypt(blob, keyVersion, aad) {
      if (blob.length < IV_LENGTH + TAG_LENGTH) {
        throw new CryptoError('encrypted blob is too short to contain iv, tag and ciphertext');
      }
      const key = getKey(keys, keyVersion);
      const iv = blob.subarray(0, IV_LENGTH);
      const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch {
        // Authentication failure (tampered blob, wrong AAD or wrong key).
        throw new CryptoError('decryption failed: blob authentication did not pass');
      }
    },

    decryptText(blob, keyVersion, aad) {
      return this.decrypt(blob, keyVersion, aad).toString('utf8');
    },
  };
}

/** Stable per-column AAD strings, e.g. `tenants.db_password`, `tenant_services.config`. */
export function aadForColumn(column: string): string {
  if (!/^[a-z_]+(\.[a-z_]+)?$/.test(column)) {
    throw new CryptoError(`invalid AAD column identifier: ${column}`);
  }
  return column;
}
