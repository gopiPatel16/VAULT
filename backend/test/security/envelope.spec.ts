import * as crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { EnvelopeCryptoService } from '../../src/common/crypto/envelope.service';
import { loadConfig, resetConfigCache } from '../../src/config/configuration';

/**
 * The at-rest container. Pure unit tests — no database, no HTTP.
 *
 * The properties that matter are not "it round-trips" but the three ways a
 * stored blob can be attacked: flipping a byte, reordering frames, and cutting
 * the file short. Framed AEAD is only worth its complexity if all three fail
 * loudly.
 */
describe('Envelope encryption', () => {
  let envelope: EnvelopeCryptoService;

  beforeAll(() => {
    resetConfigCache();
    envelope = new EnvelopeCryptoService(loadConfig());
  });

  const encrypt = async (dek: Buffer, plaintext: Buffer): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    const out = envelope.createEncryptStream(dek);
    out.on('data', (c: Buffer) => chunks.push(c));
    await pipeline(Readable.from([plaintext]), out);
    return Buffer.concat(chunks);
  };

  const decrypt = async (dek: Buffer, ciphertext: Buffer): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    const out = envelope.createDecryptStream(dek);
    out.on('data', (c: Buffer) => chunks.push(c));
    await pipeline(Readable.from([ciphertext]), out);
    return Buffer.concat(chunks);
  };

  describe('key wrapping', () => {
    it('round-trips a data key through the server KEK', () => {
      const dek = envelope.generateDek();
      const wrapped = envelope.wrapDek(dek);

      expect(wrapped.wrapped).not.toEqual(dek);
      expect(envelope.unwrapDek(wrapped)).toEqual(dek);
    });

    it('refuses a tampered wrapped key', () => {
      const wrapped = envelope.wrapDek(envelope.generateDek());
      wrapped.wrapped[0] ^= 0xff;
      expect(() => envelope.unwrapDek(wrapped)).toThrow();
    });

    it('refuses a wrapped key whose tag was replaced', () => {
      const wrapped = envelope.wrapDek(envelope.generateDek());
      wrapped.tag = crypto.randomBytes(16);
      expect(() => envelope.unwrapDek(wrapped)).toThrow();
    });
  });

  describe('document container', () => {
    it('round-trips an empty document', async () => {
      const dek = envelope.generateDek();
      const out = await decrypt(dek, await encrypt(dek, Buffer.alloc(0)));
      expect(out.length).toBe(0);
    });

    it('round-trips a payload spanning many frames', async () => {
      const dek = envelope.generateDek();
      // Deliberately not a frame multiple, so the final partial frame is exercised.
      const plaintext = crypto.randomBytes(64 * 1024 * 3 + 1234);

      const ciphertext = await encrypt(dek, plaintext);
      expect(ciphertext.subarray(0, 5).toString('ascii')).toBe('VLTF1');

      expect(await decrypt(dek, ciphertext)).toEqual(plaintext);
    });

    it('refuses the wrong key', async () => {
      const ciphertext = await encrypt(envelope.generateDek(), Buffer.from('secret'));
      await expect(decrypt(envelope.generateDek(), ciphertext)).rejects.toThrow();
    });

    it('detects a single flipped byte anywhere in the payload', async () => {
      const dek = envelope.generateDek();
      const ciphertext = await encrypt(dek, crypto.randomBytes(200_000));

      for (const offset of [20, 40_000, ciphertext.length - 40]) {
        const tampered = Buffer.from(ciphertext);
        tampered[offset] ^= 0x01;
        await expect(decrypt(dek, tampered)).rejects.toThrow();
      }
    });

    it('detects truncation — a cut-short file never decrypts as a complete one', async () => {
      const dek = envelope.generateDek();
      const plaintext = crypto.randomBytes(64 * 1024 * 2 + 500);
      const ciphertext = await encrypt(dek, plaintext);

      // Drop the final frame. Without the terminator this must fail rather than
      // yield a shorter but valid-looking document.
      const truncated = ciphertext.subarray(0, 64 * 1024 + 100);
      await expect(decrypt(dek, truncated)).rejects.toThrow(/truncated|frame/i);
    });

    it('detects a corrupted container header', async () => {
      const dek = envelope.generateDek();
      const ciphertext = await encrypt(dek, Buffer.from('hello'));
      const broken = Buffer.from(ciphertext);
      broken.write('XXXXX', 0, 'ascii');

      await expect(decrypt(dek, broken)).rejects.toThrow(/magic/i);
    });

    it('detects frames spliced from a different document', async () => {
      const dek = envelope.generateDek();
      const a = await encrypt(dek, crypto.randomBytes(64 * 1024 * 2));
      const b = await encrypt(dek, crypto.randomBytes(64 * 1024 * 2));

      // Same key, same frame position — only the per-frame nonce prefix differs,
      // which is exactly what stops one document's frame being pasted into
      // another.
      const spliced = Buffer.concat([a.subarray(0, 14 + 5 + 65536 + 16), b.subarray(14)]);
      await expect(decrypt(dek, spliced)).rejects.toThrow();
    });
  });

  describe('secret sealing', () => {
    it('round-trips a small secret under the KEK', () => {
      const secret = Buffer.from('JBSWY3DPEHPK3PXP', 'utf8');
      const sealed = envelope.encryptSecret(secret, 'vault:test');
      expect(sealed.includes(secret)).toBe(false);
      expect(envelope.decryptSecret(sealed, 'vault:test')).toEqual(secret);
    });

    it('refuses a secret sealed under a different context', () => {
      const sealed = envelope.encryptSecret(Buffer.from('x'), 'vault:test');
      expect(() => envelope.decryptSecret(sealed, 'vault:other')).toThrow();
    });
  });
});
