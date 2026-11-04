/**
 * Generates the four secrets the backend refuses to start without.
 *
 *   npm run gen:keys
 *
 * Run this on the machine that will host the deployment and paste the output
 * into `.env`. Back up STORAGE_KEK somewhere that is not the same disk as the
 * database: losing it makes every stored document permanently unreadable, and
 * no amount of administrator access can undo that.
 */
import * as crypto from 'node:crypto';

const lines = [
  `JWT_SECRET=${crypto.randomBytes(32).toString('base64')}`,
  `SERVER_PEPPER=${crypto.randomBytes(32).toString('base64')}`,
  `STORAGE_KEK=${crypto.randomBytes(32).toString('base64')}`,
  `IP_HASH_SALT=${crypto.randomBytes(16).toString('base64')}`,
];

process.stdout.write(`${lines.join('\n')}\n`);
