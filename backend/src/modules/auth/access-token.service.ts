import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import { timingSafeEqual } from '../../common/crypto/hashing';
import { AppError } from '../../common/errors/app-error';

/**
 * Client access tokens.
 *
 * Deliberately a hand-rolled HS256 JWT rather than a library call. The whole
 * verifier is thirty lines and does exactly one thing: recompute an HMAC with
 * the single configured key and compare it. There is no algorithm negotiation,
 * so the `alg: none` and RS256→HS256 confusion families cannot apply, and there
 * is no third-party parser between an attacker's bytes and our trust decision.
 *
 * The token carries identity but confers nothing on its own: DeviceStatusGuard
 * re-reads the session, device and client from the database on every request.
 */

const AUDIENCE = 'vault:client';
const HEADER = Buffer.from(
  JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
).toString('base64url');

export interface ClientAccessClaims {
  /** client id */
  sub: string;
  /** device id */
  did: string;
  /** session id */
  sid: string;
  jti: string;
  aud: string;
  iat: number;
  exp: number;
}

@Injectable()
export class AccessTokenService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private sign(data: string): Buffer {
    return crypto.createHmac('sha256', this.config.jwtSecret).update(data).digest();
  }

  issueClientAccessToken(params: {
    clientId: string;
    deviceId: string;
    sessionId: string;
  }): { token: string; expiresIn: number; jti: string } {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.config.accessTokenTtlSeconds;
    const jti = crypto.randomBytes(12).toString('base64url');

    const claims: ClientAccessClaims = {
      sub: params.clientId,
      did: params.deviceId,
      sid: params.sessionId,
      jti,
      aud: AUDIENCE,
      iat: now,
      exp: now + expiresIn,
    };

    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${HEADER}.${payload}`;
    const signature = this.sign(signingInput).toString('base64url');

    return { token: `${signingInput}.${signature}`, expiresIn, jti };
  }

  verifyClientAccessToken(token: string): ClientAccessClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw AppError.unauthorized('malformed access token');
    }
    const [header, payload, signature] = parts;

    // Fixed header, compared byte for byte. Nothing in the token influences
    // which algorithm or key is used.
    if (header !== HEADER) {
      throw AppError.unauthorized('unexpected access token header');
    }

    const expected = this.sign(`${header}.${payload}`);
    if (!timingSafeEqual(Buffer.from(signature, 'base64url'), expected)) {
      throw AppError.unauthorized('access token signature mismatch');
    }

    let claims: ClientAccessClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw AppError.unauthorized('unparseable access token payload');
    }

    if (claims.aud !== AUDIENCE) {
      throw AppError.unauthorized('wrong token audience', { aud: claims.aud });
    }
    if (!claims.sub || !claims.did || !claims.sid || !claims.jti) {
      throw AppError.unauthorized('access token missing required claims');
    }
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw AppError.unauthorized('access token expired');
    }

    return claims;
  }
}
