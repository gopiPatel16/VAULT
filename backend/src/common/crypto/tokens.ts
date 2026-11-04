import * as crypto from 'node:crypto';
import { sha256 } from './hashing';

/**
 * Opaque bearer secrets: refresh tokens, document grants, enrolment codes,
 * admin session tokens.
 *
 * All of them are 256 bits of randomness stored only as a SHA-256 digest. A
 * database dump therefore yields no usable token. They are deliberately not
 * JWTs — a self-contained token cannot be revoked without a server-side
 * lookup anyway, and a server-side lookup is what makes "invalidate every
 * document session everywhere" (ARCHITECTURE §12) a single UPDATE.
 *
 * These are high-entropy random values, not passwords, so a fast digest is the
 * correct choice; Argon2 would buy nothing against a 256-bit search space.
 */

export interface OpaqueToken {
  /** Returned to the caller exactly once, never persisted. */
  value: string;
  /** What goes in the database. */
  hash: Buffer;
}

export function issueOpaqueToken(bytes = 32): OpaqueToken {
  const value = crypto.randomBytes(bytes).toString('base64url');
  return { value, hash: sha256(value) };
}

export function hashOpaqueToken(value: string): Buffer {
  return sha256(value);
}

/**
 * Human-transcribable enrolment code: 8 groups of 4 unambiguous characters.
 * Excludes 0/O/1/I/L to survive being read aloud or typed from a screen.
 */
export function issueEnrollmentCode(): OpaqueToken {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const raw = crypto.randomBytes(32);
  let out = '';
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 5 === 0) out += '-';
    out += alphabet[raw[i] % alphabet.length];
  }
  return { value: out, hash: sha256(out) };
}
