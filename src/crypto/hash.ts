import { createHash, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';

/** SHA-256 of the full input; used for API key hashes (section 7) and signatures. */
export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

/**
 * Constant-time comparison for secrets (architecture document, section 14).
 * Length is compared first (the doc explicitly requires this pre-check);
 * different lengths return false without leaking how different they are.
 */
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const bufA = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const bufB = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return nodeTimingSafeEqual(bufA, bufB);
}

/** Random bytes — the only sanctioned randomness source in the codebase. */
export function randomBytesBuf(size: number): Buffer {
  return randomBytes(size);
}

/** Random URL-safe token of `size` random bytes (base64url encoded). */
export function randomBase64Url(size: number): string {
  return randomBytes(size).toString('base64url');
}
