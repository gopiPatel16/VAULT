import { Injectable, Inject } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { Transform, TransformCallback } from 'node:stream';
import { APP_CONFIG, AppConfig } from '../../config/configuration';

/**
 * Envelope encryption for documents at rest.
 *
 *   per-file DEK (random 256-bit)  ──encrypts──▶  document bytes
 *   server KEK (from config)       ──wraps─────▶  the DEK (stored in the DB)
 *
 * The DEK is deliberately NOT derived from the Document Master Password.
 * See docs/ARCHITECTURE.md §7.3 for the trade-off and its consequences — in
 * short, this buys recoverability and server-side search at the cost of not
 * being zero-knowledge against a fully compromised server.
 *
 * ── On-disk format ──────────────────────────────────────────────────────────
 *
 *   header : "VLTF1" (5) | version (1) | nonce prefix (8)          = 14 bytes
 *   frame  : plaintext length uint32be (4) | final flag (1)
 *            | ciphertext (len) | GCM tag (16)
 *
 *   frame nonce = nonce prefix (8) || frame counter uint32be (4)
 *   frame AAD   = version (1) || counter uint32be (4) || final flag (1)
 *
 * Framing rather than one giant GCM blob is a deliberate choice: a single-tag
 * stream can only be authenticated after the last byte, which means a server
 * streaming a large file hands the client unverified plaintext for the whole
 * transfer. Per-frame tags authenticate as we go, and binding the counter and
 * the final flag into the AAD makes reordering, splicing and truncation all
 * detectable.
 */

const MAGIC = Buffer.from('VLTF1', 'ascii');
const VERSION = 1;
const HEADER_LEN = MAGIC.length + 1 + 8;
const FRAME_HEADER_LEN = 5;
const TAG_LEN = 16;
const PLAINTEXT_FRAME_SIZE = 64 * 1024;
const DEK_AAD = Buffer.from('vault:dek:v1', 'ascii');

export interface WrappedDek {
  wrapped: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

function frameAad(counter: number, isFinal: boolean): Buffer {
  const aad = Buffer.alloc(6);
  aad.writeUInt8(VERSION, 0);
  aad.writeUInt32BE(counter, 1);
  aad.writeUInt8(isFinal ? 1 : 0, 5);
  return aad;
}

function frameNonce(prefix: Buffer, counter: number): Buffer {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0, 0, 8);
  nonce.writeUInt32BE(counter, 8);
  return nonce;
}

class EncryptTransform extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private counter = 0;
  private headerSent = false;

  constructor(
    private readonly dek: Buffer,
    private readonly noncePrefix: Buffer,
  ) {
    super();
  }

  private emitFrame(plaintext: Buffer, isFinal: boolean): void {
    const cipher = crypto.createCipheriv(
      'aes-256-gcm',
      this.dek,
      frameNonce(this.noncePrefix, this.counter),
    );
    cipher.setAAD(frameAad(this.counter, isFinal));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const head = Buffer.alloc(FRAME_HEADER_LEN);
    head.writeUInt32BE(plaintext.length, 0);
    head.writeUInt8(isFinal ? 1 : 0, 4);
    this.push(Buffer.concat([head, ciphertext, cipher.getAuthTag()]));
    this.counter += 1;
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      if (!this.headerSent) {
        this.push(
          Buffer.concat([MAGIC, Buffer.from([VERSION]), this.noncePrefix]),
        );
        this.headerSent = true;
      }
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= PLAINTEXT_FRAME_SIZE) {
        this.emitFrame(this.buffer.subarray(0, PLAINTEXT_FRAME_SIZE), false);
        this.buffer = this.buffer.subarray(PLAINTEXT_FRAME_SIZE);
      }
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  _flush(cb: TransformCallback): void {
    try {
      if (!this.headerSent) {
        this.push(
          Buffer.concat([MAGIC, Buffer.from([VERSION]), this.noncePrefix]),
        );
        this.headerSent = true;
      }
      // Exactly one final frame always terminates the stream, so a truncated
      // file can never be mistaken for a complete one.
      this.emitFrame(this.buffer, true);
      this.buffer = Buffer.alloc(0);
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }
}

class DecryptTransform extends Transform {
  private buffer: Buffer = Buffer.alloc(0);
  private counter = 0;
  private noncePrefix: Buffer | null = null;
  private sawFinal = false;

  constructor(private readonly dek: Buffer) {
    super();
  }

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      if (!this.noncePrefix) {
        if (this.buffer.length < HEADER_LEN) return cb();
        const magic = this.buffer.subarray(0, MAGIC.length);
        if (!magic.equals(MAGIC)) throw new Error('bad container magic');
        const version = this.buffer.readUInt8(MAGIC.length);
        if (version !== VERSION) throw new Error('unsupported container version');
        this.noncePrefix = Buffer.from(
          this.buffer.subarray(MAGIC.length + 1, HEADER_LEN),
        );
        this.buffer = this.buffer.subarray(HEADER_LEN);
      }

      for (;;) {
        if (this.buffer.length < FRAME_HEADER_LEN) break;
        const len = this.buffer.readUInt32BE(0);
        if (len > PLAINTEXT_FRAME_SIZE) throw new Error('frame length out of range');
        const isFinal = this.buffer.readUInt8(4) === 1;
        const total = FRAME_HEADER_LEN + len + TAG_LEN;
        if (this.buffer.length < total) break;
        if (this.sawFinal) throw new Error('data after final frame');

        const ciphertext = this.buffer.subarray(FRAME_HEADER_LEN, FRAME_HEADER_LEN + len);
        const tag = this.buffer.subarray(FRAME_HEADER_LEN + len, total);

        const decipher = crypto.createDecipheriv(
          'aes-256-gcm',
          this.dek,
          frameNonce(this.noncePrefix, this.counter),
        );
        decipher.setAAD(frameAad(this.counter, isFinal));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(), // throws on tag mismatch — before we push anything
        ]);

        if (plaintext.length > 0) this.push(plaintext);
        this.counter += 1;
        this.sawFinal = isFinal;
        this.buffer = this.buffer.subarray(total);
      }
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  _flush(cb: TransformCallback): void {
    if (!this.sawFinal) {
      return cb(new Error('truncated container: no final frame'));
    }
    if (this.buffer.length > 0) {
      return cb(new Error('trailing bytes after final frame'));
    }
    cb();
  }
}

@Injectable()
export class EnvelopeCryptoService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  generateDek(): Buffer {
    return crypto.randomBytes(32);
  }

  wrapDek(dek: Buffer): WrappedDek {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.config.storageKek, nonce);
    cipher.setAAD(DEK_AAD);
    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    return { wrapped, nonce, tag: cipher.getAuthTag() };
  }

  unwrapDek(w: WrappedDek): Buffer {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.config.storageKek,
      w.nonce,
    );
    decipher.setAAD(DEK_AAD);
    decipher.setAuthTag(w.tag);
    return Buffer.concat([decipher.update(w.wrapped), decipher.final()]);
  }

  /**
   * Seal a small secret directly under the KEK — used for administrator TOTP
   * seeds, which must be recoverable by the server (to verify a code) but must
   * not sit in the database in the clear.
   *
   * Layout: nonce (12) || tag (16) || ciphertext.
   */
  encryptSecret(plaintext: Buffer, aad: string): Buffer {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.config.storageKek, nonce);
    cipher.setAAD(Buffer.from(aad, 'ascii'));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ct]);
  }

  decryptSecret(sealed: Buffer, aad: string): Buffer {
    if (sealed.length < 28) throw new Error('sealed secret too short');
    const nonce = sealed.subarray(0, 12);
    const tag = sealed.subarray(12, 28);
    const ct = sealed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.config.storageKek, nonce);
    decipher.setAAD(Buffer.from(aad, 'ascii'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  createEncryptStream(dek: Buffer): Transform {
    return new EncryptTransform(dek, crypto.randomBytes(8));
  }

  createDecryptStream(dek: Buffer): Transform {
    return new DecryptTransform(dek);
  }
}
