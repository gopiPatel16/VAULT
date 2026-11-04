import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AccessTokenService } from '../../modules/auth/access-token.service';
import { AppError } from '../errors/app-error';
import type { VaultRequest } from '../request-context';

/**
 * Layer 1, part one: the bearer access token.
 *
 * Verifies the signature and claims only — no database work happens here, so a
 * garbage token costs almost nothing. DeviceStatusGuard does the single lookup
 * that confirms the session, device and client are all still live.
 *
 * The token audience is checked strictly. An administrator token can never
 * satisfy a client route and vice versa, even if a route were misfiled.
 */
@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(private readonly tokens: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<VaultRequest>();
    if (req.vault.scope !== 'client') return true;

    const header = req.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw?.startsWith('Bearer ')) {
      throw AppError.unauthorized('missing bearer token');
    }

    const claims = this.tokens.verifyClientAccessToken(raw.slice(7).trim());

    // The signature guard already proved possession of *a* device key. This
    // binds that proof to the identity inside the token: presenting device A's
    // signature alongside device B's token is rejected.
    if (req.vault.signedDeviceId !== claims.did) {
      throw AppError.unauthorized('signing device does not match token device', {
        signed: req.vault.signedDeviceId,
        token: claims.did,
      });
    }

    req.vault.tokenJti = claims.jti;
    req.vault.session = { id: claims.sid };
    // `client` and `device` are populated by DeviceStatusGuard from the
    // database, never from token claims — a token says who the caller *was*
    // when it was issued, not who they still are.
    return true;
  }
}
