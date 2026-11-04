import * as crypto from 'node:crypto';

export function sha256(data: Buffer | string): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

/** Timing-safe equality that also tolerates length mismatch without throwing. */
export function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Still burn a comparison so the failure path is not obviously shorter.
    crypto.timingSafeEqual(sha256(a), sha256(b));
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Audit logs record a salted hash of the peer address, never the address
 * itself. Enough to correlate an attack; not enough to build a location
 * history out of a stolen database.
 */
export function hashIp(ip: string | undefined, salt: Buffer): string {
  if (!ip) return 'unknown';
  return crypto.createHmac('sha256', salt).update(ip).digest('base64url');
}
