/**
 * Creates the first administrator.
 *
 *   npm run bootstrap:admin
 *
 * Deliberately a local CLI and not a web "first-run setup" page. A setup page
 * on a fresh deployment is a race: whoever reaches it first becomes the
 * administrator, and on an internet-facing host that is not necessarily you.
 * Requiring shell access on the machine removes that race entirely.
 *
 * Prints the TOTP secret and the recovery codes exactly once. They are not
 * recoverable afterwards — the database holds only an encrypted seed and
 * Argon2id hashes.
 */
import 'reflect-metadata';
import * as readline from 'node:readline';
import * as crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import { loadEnvFile } from '../src/config/load-env';
import { loadConfig } from '../src/config/configuration';
import { PasswordService } from '../src/common/crypto/password.service';
import { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import { TOTP_AAD } from '../src/modules/admin/admin-auth.service';
import { toDbBytes } from '../src/common/crypto/bytes';

loadEnvFile();

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Reads without echoing, so the password does not end up in a scrollback. */
function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      return reject(new Error('a terminal is required to enter a password'));
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const ENTER = ['\n', '\r'];
    const EOT = '\u0004';
    const INTERRUPT = '\u0003';
    const BACKSPACE = '\u007f';

    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };

    const onData = (char: string): void => {
      if (ENTER.includes(char) || char === EOT) {
        finish();
        resolve(value);
      } else if (char === INTERRUPT) {
        finish();
        process.exit(130);
      } else if (char === BACKSPACE) {
        value = value.slice(0, -1);
      } else {
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

function generateRecoveryCodes(count = 8): string[] {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(16);
    let out = '';
    for (let i = 0; i < 16; i++) {
      if (i > 0 && i % 4 === 0) out += '-';
      out += alphabet[raw[i] % alphabet.length];
    }
    return out;
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const passwords = new PasswordService(config);
  const envelope = new EnvelopeCryptoService(config);

  try {
    const existing = await prisma.admin.count();
    if (existing > 0) {
      process.stdout.write(
        `\nAn administrator already exists (${existing} on record).\n` +
          `Refusing to create another from this script.\n`,
      );
      process.exit(1);
    }

    process.stdout.write('\nVault — create the first administrator\n\n');

    const username = (await ask('Username: ')).toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      throw new Error('username may contain 3-64 of: letters digits . _ -');
    }

    const password = await askSecret('Password (16+ characters): ');
    if (password.length < 16) {
      throw new Error('administrator password must be at least 16 characters');
    }
    const confirm = await askSecret('Confirm password: ');
    if (password !== confirm) throw new Error('passwords do not match');

    const totpSecret = authenticator.generateSecret(32);
    const recoveryCodes = generateRecoveryCodes();

    const admin = await prisma.admin.create({
      data: {
        username,
        passwordHash: await passwords.hash(password),
        totpSecretEnc: toDbBytes(
          envelope.encryptSecret(Buffer.from(totpSecret, 'utf8'), TOTP_AAD),
        ),
        totpEnabled: true,
        recoveryCodeHashes: await Promise.all(
          recoveryCodes.map((code) => passwords.hash(code)),
        ),
      },
    });

    const uri = authenticator.keyuri(username, 'Vault', totpSecret);

    process.stdout.write(
      [
        '',
        'Administrator created.',
        '',
        `  id:       ${admin.id}`,
        `  username: ${username}`,
        '',
        'Two-factor setup — add this to your authenticator app now:',
        '',
        `  secret:   ${totpSecret}`,
        `  otpauth:  ${uri}`,
        '',
        'Recovery codes — each works once, for administrator account recovery',
        'only. They do NOT reveal or reset the Document Master Password.',
        'Store them somewhere other than this machine:',
        '',
        ...recoveryCodes.map((c) => `  ${c}`),
        '',
        'This is the only time any of the above will be shown.',
        '',
        'Next: sign in to the admin console and set the Document Master Password.',
        'Until it is set, no document contents can be read by anyone.',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
