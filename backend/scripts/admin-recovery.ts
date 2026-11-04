/**
 * Administrator account recovery.
 *
 *   npx ts-node -T scripts/admin-recovery.ts
 *
 * Deliberately a LOCAL CLI with no network endpoint anywhere in the API.
 * §14 asks for recovery that is not "forgot password → send password"; the
 * safest version of that is recovery which requires physical or shell access to
 * the machine plus a code that was printed once and stored elsewhere.
 *
 * What this does:      resets the administrator password and TOTP seed.
 * What it never does:  reveal, reset, or bypass the Document Master Password.
 *
 * That separation is the whole point. Because document encryption keys are
 * wrapped by the server KEK rather than derived from the master password
 * (docs/ARCHITECTURE.md §7.3), recovering the administrator account does not
 * silently unlock document contents — the new administrator still cannot read
 * a document without knowing the Document Master Password, and cannot learn it
 * from anything stored in the database.
 *
 * If the Document Master Password itself is lost, the correct outcome is that
 * an administrator sets a NEW one. Existing documents remain readable because
 * their keys were never tied to it.
 */
import 'reflect-metadata';
import * as readline from 'node:readline';
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

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const passwords = new PasswordService(config);
  const envelope = new EnvelopeCryptoService(config);

  try {
    const username = (await ask('Administrator username: ')).toLowerCase();
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) {
      // Local CLI, local operator — being vague here would only waste the
      // operator's time without denying an attacker anything they could not
      // already read from the database they are standing on.
      throw new Error('no such administrator');
    }

    const code = (await ask('Recovery code: ')).toUpperCase();

    let matchedIndex = -1;
    for (let i = 0; i < admin.recoveryCodeHashes.length; i++) {
      if (await passwords.verify(admin.recoveryCodeHashes[i], code)) {
        matchedIndex = i;
        break;
      }
    }
    if (matchedIndex === -1) throw new Error('recovery code rejected');

    const password = await ask('New administrator password (16+ chars): ');
    if (password.length < 16) throw new Error('password must be at least 16 characters');
    const confirm = await ask('Confirm: ');
    if (password !== confirm) throw new Error('passwords do not match');

    const totpSecret = authenticator.generateSecret(32);

    await prisma.$transaction([
      prisma.admin.update({
        where: { id: admin.id },
        data: {
          passwordHash: await passwords.hash(password),
          totpSecretEnc: toDbBytes(
            envelope.encryptSecret(Buffer.from(totpSecret, 'utf8'), TOTP_AAD),
          ),
          failedAttempts: 0,
          lockedUntil: null,
          // The used code is burned. Recovery codes are single-use.
          recoveryCodeHashes: admin.recoveryCodeHashes.filter((_, i) => i !== matchedIndex),
        },
      }),
      // Any session that existed before a recovery is suspect.
      prisma.adminSession.updateMany({
        where: { adminId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    process.stdout.write(
      [
        '',
        'Administrator credentials reset.',
        '',
        `  new TOTP secret:  ${totpSecret}`,
        `  otpauth:          ${authenticator.keyuri(username, 'Vault', totpSecret)}`,
        '',
        `  recovery codes remaining: ${admin.recoveryCodeHashes.length - 1}`,
        '',
        'The Document Master Password was NOT changed and was NOT revealed.',
        'Document contents remain protected by it exactly as before.',
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
