import { Injectable, Inject, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { APP_CONFIG, AppConfig } from '../../config/configuration';
import type { StorageDriver } from './storage.driver';

/**
 * Local encrypted blob store.
 *
 * Keys look like `ab/cd/<uuid>.bin`. The two fan-out levels keep directory
 * sizes reasonable; the name itself is random. Nothing in a key derives from a
 * filename, a title, a category or a client id, so a key leaking would reveal
 * nothing, and a hostile "filename" can never become a path.
 *
 * `resolve()` re-checks that every path stays inside the storage root. Given
 * that keys are generated internally this should be unreachable — which is
 * exactly why it is worth having: it is the assertion that catches the day
 * someone adds a code path that passes a key in from outside.
 */
@Injectable()
export class LocalDiskStorageDriver implements StorageDriver {
  private readonly logger = new Logger(LocalDiskStorageDriver.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  allocateKey(): string {
    const id = crypto.randomUUID();
    return `${id.slice(0, 2)}/${id.slice(2, 4)}/${id}.bin`;
  }

  private resolve(key: string): string {
    const root = this.config.storageRoot;
    const full = path.resolve(root, key);
    const rel = path.relative(root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      // Not a client-triggerable path today. Kept as a hard stop so it can
      // never become one.
      throw new Error('storage key escapes the storage root');
    }
    return full;
  }

  async createWriteStream(key: string): Promise<Writable> {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    return fs.createWriteStream(full, { mode: 0o600, flags: 'wx' });
  }

  /**
   * Opens the object before returning a stream.
   *
   * `fs.createReadStream` reports a missing file asynchronously, via an 'error'
   * event on a stream the caller has usually already handed to the HTTP layer.
   * By then the failure can no longer become a clean 404 — the response hangs
   * until the client gives up, which is both a bad experience and a timing
   * signal. Opening first turns "the blob is gone" back into an ordinary
   * rejected promise that `DocumentsService` converts to a 404 like any other
   * miss.
   */
  async createReadStream(key: string): Promise<Readable> {
    const handle = await fsp.open(this.resolve(key), 'r');
    return handle.createReadStream({ autoClose: true });
  }

  async delete(key: string): Promise<void> {
    try {
      await fsp.unlink(this.resolve(key));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw err;
      this.logger.warn(`delete: object already absent`);
    }
  }

  async stat(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const s = await fsp.stat(this.resolve(key));
      return { sizeBytes: s.size };
    } catch {
      return null;
    }
  }

  async usage(): Promise<{ bytes: number; objects: number }> {
    let bytes = 0;
    let objects = 0;

    const walk = async (dir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          objects += 1;
          bytes += (await fsp.stat(full)).size;
        }
      }
    };

    await walk(this.config.storageRoot);
    return { bytes, objects };
  }
}
