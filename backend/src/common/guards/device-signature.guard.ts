import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SignatureService } from '../crypto/signature.service';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AppError } from '../errors/app-error';
import type { VaultRequest } from '../request-context';
import { fromDbBytes } from '../crypto/bytes';

/**
 * Proof that the request came from an enrolled device, not merely from
 * something holding a copied token.
 *
 * Three modes, by route scope:
 *   enrollment — signature checked against the public key in the request body
 *                (proof of possession of the key being enrolled)
 *   device     — signature checked against the stored key; no bearer token yet
 *   client     — same, plus ClientAuthGuard later binds it to the access token
 */
@Injectable()
export class DeviceSignatureGuard implements CanActivate {
  constructor(
    private readonly signatures: SignatureService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<VaultRequest>();
    const scope = req.vault.scope;
    if (scope !== 'enrollment' && scope !== 'device' && scope !== 'client') {
      return true;
    }

    const deviceId = this.header(req, 'x-device-id');
    const timestamp = Number(this.header(req, 'x-timestamp'));
    const nonce = this.header(req, 'x-nonce');
    const signatureB64 = this.header(req, 'x-signature');

    if (!deviceId || !nonce || !signatureB64 || !Number.isFinite(timestamp)) {
      throw AppError.unauthorized('missing device signature headers', {
        scope,
        haveDeviceId: Boolean(deviceId),
      });
    }

    let spkiPublicKey: Buffer;
    if (scope === 'enrollment') {
      const body = req.body as { publicKey?: unknown } | undefined;
      if (typeof body?.publicKey !== 'string') {
        throw AppError.invalidRequest('enrolment requires publicKey');
      }
      spkiPublicKey = Buffer.from(body.publicKey, 'base64');
      // A P-256 SPKI DER is 91 bytes; the range leaves room for encoder
      // variation without accepting something structurally unrelated. The
      // real check is that SignatureService parses it AND confirms the curve.
      if (spkiPublicKey.length < 80 || spkiPublicKey.length > 120) {
        throw AppError.invalidRequest('publicKey must be a P-256 SPKI DER key');
      }
    } else {
      const device = await this.prisma.device.findUnique({
        where: { id: isUuid(deviceId) ? deviceId : NIL_UUID },
        select: { publicKey: true },
      });
      if (!device) {
        throw AppError.unauthorized('unknown device id', { deviceId });
      }
      spkiPublicKey = fromDbBytes(device.publicKey);
    }

    const result = this.signatures.verify({
      spkiPublicKey,
      method: req.method,
      urlWithQuery: req.url,
      rawBody: req.rawBody ?? Buffer.alloc(0),
      headers: {
        deviceId,
        timestampMs: timestamp,
        nonce,
        signature: Buffer.from(signatureB64, 'base64'),
      },
    });

    if (!result.ok) {
      throw AppError.unauthorized(`device signature rejected: ${result.reason}`, {
        deviceId,
        scope,
      });
    }

    req.vault.signedDeviceId = deviceId;
    return true;
  }

  private header(req: VaultRequest, name: string): string {
    const v = req.headers[name];
    return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
  }
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Postgres rejects a malformed uuid with a database error; substituting the
 *  nil uuid keeps a hostile header on the ordinary "unknown device" path. */
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
