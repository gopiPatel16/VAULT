import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { sha256 } from './hashing';

/**
 * Device request signing — ECDSA on NIST P-256, SHA-256.
 *
 * Every client request is signed with a private key held in the device's
 * secure hardware. This is what makes a stolen access token useless on its
 * own: the §31 threat "attacker modifies local client storage" yields a token
 * but not a usable credential, because the key that must co-sign the request
 * cannot be copied out.
 *
 * ── Why P-256 and not Ed25519 ────────────────────────────────────────────────
 *
 * The approved architecture said Ed25519. That was wrong, and the reason is
 * worth recording: Apple's Secure Enclave only generates and holds NIST P-256
 * keys, and Android's StrongBox is likewise EC/RSA. An Ed25519 device key can
 * therefore only ever live in software — protected at rest in the Keychain,
 * but loadable into app memory and extractable on a compromised device, which
 * is exactly the property the device key exists to deny.
 *
 * Choosing P-256 is what makes hardware-backed keys possible at all. Making
 * the change now costs a few lines; making it later would mean a wire-format
 * break and re-enrolling every device.
 *
 * ── Canonical string (newline separated, no trailing newline) ───────────────
 *
 *   v1
 *   <HTTP METHOD, uppercase>
 *   <path with query string, exactly as sent>
 *   <unix milliseconds>
 *   <nonce>
 *   <lowercase hex sha256 of the raw request body, empty string hashed if none>
 */

export interface SignatureHeaders {
  deviceId: string;
  timestampMs: number;
  nonce: string;
  signature: Buffer;
}

const P256_CURVE = 'prime256v1';

@Injectable()
export class SignatureService {
  /**
   * Seen nonces, keyed `deviceId:nonce`, holding their expiry. In-memory and
   * therefore per-process: a multi-instance deployment must move this to Redis
   * or replay protection degrades to the clock-skew window. Documented rather
   * than silently accepted.
   */
  private readonly seen = new Map<string, number>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
  }

  canonicalString(
    method: string,
    urlWithQuery: string,
    timestampMs: number,
    nonce: string,
    rawBody: Buffer,
  ): Buffer {
    return Buffer.from(
      [
        'v1',
        method.toUpperCase(),
        urlWithQuery,
        String(timestampMs),
        nonce,
        sha256(rawBody).toString('hex'),
      ].join('\n'),
      'utf8',
    );
  }

  /**
   * Parses a device public key from its SPKI DER encoding — the form both
   * Secure Enclave and Android Keystore export natively, so nothing has to
   * reassemble a point on either platform.
   *
   * Throws unless the key is genuinely P-256: a caller that could enrol a key
   * on a weaker curve would pick its own security level.
   */
  publicKeyFromSpki(der: Buffer): crypto.KeyObject {
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec') {
      throw new Error(`expected an EC key, got ${key.asymmetricKeyType}`);
    }
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve !== P256_CURVE) {
      throw new Error(`expected curve ${P256_CURVE}, got ${curve}`);
    }
    return key;
  }

  /** Rejects a stale timestamp, a replayed nonce, or a bad signature. */
  verify(params: {
    spkiPublicKey: Buffer;
    method: string;
    urlWithQuery: string;
    rawBody: Buffer;
    headers: SignatureHeaders;
  }): { ok: true } | { ok: false; reason: string } {
    const { headers } = params;
    const skewMs = this.config.signatureWindowSeconds * 1000;
    const drift = Math.abs(Date.now() - headers.timestampMs);
    if (!Number.isFinite(headers.timestampMs) || drift > skewMs) {
      return { ok: false, reason: `timestamp outside window (drift ${drift}ms)` };
    }

    const nonceKey = `${headers.deviceId}:${headers.nonce}`;
    if (this.seen.has(nonceKey)) {
      return { ok: false, reason: 'nonce replayed' };
    }

    let key: crypto.KeyObject;
    try {
      key = this.publicKeyFromSpki(params.spkiPublicKey);
    } catch (e) {
      return { ok: false, reason: `malformed device public key: ${String(e)}` };
    }

    const message = this.canonicalString(
      params.method,
      params.urlWithQuery,
      headers.timestampMs,
      headers.nonce,
      params.rawBody,
    );

    if (!this.verifyEcdsa(message, key, headers.signature)) {
      return { ok: false, reason: 'signature verification failed' };
    }

    // Only remembered once the signature is known good, so an attacker cannot
    // fill the cache with junk nonces.
    this.seen.set(nonceKey, Date.now() + skewMs * 2);
    return { ok: true };
  }

  /**
   * Exposes the raw cryptographic check, without the freshness and replay
   * rules layered on top. Used by the cross-language interop fixture, whose
   * timestamp is fixed and therefore permanently stale — that test is about
   * whether the signature verifies at all, which is a separate question from
   * whether the request is fresh.
   */
  verifyForTest(spkiPublicKey: Buffer, message: Buffer, signature: Buffer): boolean {
    try {
      return this.verifyEcdsa(message, this.publicKeyFromSpki(spkiPublicKey), signature);
    } catch {
      return false;
    }
  }

  /**
   * Accepts both ECDSA signature encodings.
   *
   * Secure Enclave and Android Keystore emit DER; WebCrypto and most pure-Dart
   * implementations emit raw r‖s (IEEE P1363). The two are the same signature
   * in different clothes, so accepting either costs nothing in security and
   * saves every client platform from fragile re-encoding code. Anything that
   * is neither still fails.
   */
  private verifyEcdsa(
    message: Buffer,
    key: crypto.KeyObject,
    signature: Buffer,
  ): boolean {
    const attempt = (dsaEncoding: 'der' | 'ieee-p1363'): boolean => {
      try {
        return crypto.verify('sha256', message, { key, dsaEncoding }, signature);
      } catch {
        return false;
      }
    };

    if (signature.length === 64) return attempt('ieee-p1363') || attempt('der');
    return attempt('der') || attempt('ieee-p1363');
  }
}
