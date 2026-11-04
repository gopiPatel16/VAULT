import { Injectable, Inject } from '@nestjs/common';
import * as argon2 from 'argon2';
import { APP_CONFIG, AppConfig } from '../../config/configuration';

/**
 * Argon2id for every human-supplied secret: admin passwords, client passwords
 * and the Document Master Password.
 *
 * A server-side pepper is mixed in before hashing. It lives in the process
 * configuration, not the database, so a stolen database dump alone does not
 * enable an offline cracking run.
 */
@Injectable()
export class PasswordService {
  /** A real Argon2id hash of a random value, used to spend time on paths where
   *  no stored hash exists — so "unknown account" and "wrong password" cost the
   *  same. Computed lazily and reused. */
  private dummyHash: string | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private peppered(password: string): Buffer {
    return Buffer.concat([
      Buffer.from(password, 'utf8'),
      this.config.serverPepper,
    ]);
  }

  private get options(): argon2.Options {
    return {
      type: argon2.argon2id,
      memoryCost: this.config.argon2.memoryCost,
      timeCost: this.config.argon2.timeCost,
      parallelism: this.config.argon2.parallelism,
    };
  }

  async hash(password: string): Promise<string> {
    return argon2.hash(this.peppered(password), this.options);
  }

  async verify(storedHash: string | null | undefined, password: string): Promise<boolean> {
    if (!storedHash) {
      await this.burnTime();
      return false;
    }
    try {
      return await argon2.verify(storedHash, this.peppered(password));
    } catch {
      // Malformed stored hash. Treated as a failed verification, never as an
      // error the caller can observe.
      return false;
    }
  }

  /**
   * Spend roughly one verification's worth of time without a stored hash.
   * Called when an account, device or master password does not exist, so that
   * response timing does not become an enumeration oracle.
   */
  async burnTime(): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = await argon2.hash(
        Buffer.concat([Buffer.from('vault-dummy'), this.config.serverPepper]),
        this.options,
      );
    }
    try {
      await argon2.verify(this.dummyHash, Buffer.from('not-the-password'));
    } catch {
      /* expected */
    }
  }
}
