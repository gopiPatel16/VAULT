/**
 * Bridge between Node's `Buffer` and the `Uint8Array<ArrayBuffer>` that
 * Prisma's `Bytes` columns expect.
 *
 * `Buffer` is backed by `ArrayBufferLike` (it may sit on a `SharedArrayBuffer`),
 * which is why TypeScript will not hand one straight to Prisma. Copying into a
 * freshly allocated `ArrayBuffer` satisfies that honestly rather than casting
 * the difference away. Everything crossing this boundary is small and secret —
 * hashes, wrapped keys, public keys — so the copy costs nothing.
 */

export function toDbBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

export function fromDbBytes(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
