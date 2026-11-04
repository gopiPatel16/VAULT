/**
 * Content-type detection from magic bytes.
 *
 * The extension and the `Content-Type` a client sends are treated as decoration
 * and discarded. Only what is actually in the bytes decides what the file is,
 * and only an allow-listed set is accepted (§25: "do not trust file extensions
 * supplied by clients").
 *
 * Hand-written rather than pulled from a dependency: the allowlist is eight
 * formats, the whole check is auditable in one screen, and a file-type library
 * that recognises two hundred formats is two hundred formats' worth of parsing
 * surface we would rather not have in front of untrusted input.
 */

export const ALLOWED_TYPES = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;

/** Types the preview endpoint can render directly, without conversion. */
export const DIRECTLY_PREVIEWABLE: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1',
]);

/** Control characters that should never appear in a text document or a name.
 *  Built from a string so the source file itself stays plain ASCII. */
const CONTROL_CHAR_PATTERN = '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]';
const CONTROL_CHARS = new RegExp(CONTROL_CHAR_PATTERN);
const CONTROL_CHARS_GLOBAL = new RegExp(CONTROL_CHAR_PATTERN, 'g');

function startsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((b, i) => buf[i] === b);
}

/** Valid UTF-8 with no unexpected control characters. */
function looksLikePlainText(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return false;
  }
  return !CONTROL_CHARS.test(text);
}

/**
 * @param head  first bytes of the file — 64 KiB is plenty
 * @returns the detected type, or null if it is not something we accept
 */
export function sniffMime(head: Buffer): AllowedMime | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('ascii') === 'RIFF' &&
    head.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp') {
    if (HEIF_BRANDS.has(head.subarray(8, 12).toString('ascii'))) return 'image/heic';
  }

  // OOXML containers are ordinary zips. Rather than unpack untrusted archive
  // structures we look for the part-name prefixes Word and Excel always write.
  // A zip that does not clearly announce itself as exactly one of the two is
  // rejected — failing closed on an ambiguous archive is the right default.
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    const text = head.subarray(0, Math.min(head.length, 65536)).toString('latin1');
    const hasWord = text.includes('word/');
    const hasExcel = text.includes('xl/');
    if (hasWord && !hasExcel) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (hasExcel && !hasWord) {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    return null;
  }

  if (looksLikePlainText(head)) return 'text/plain';

  return null;
}

/**
 * Reduce a client-supplied filename to something safe to store as a display
 * label and to echo back in a Content-Disposition header.
 *
 * This value is NEVER used as a path component — storage keys are generated
 * server-side — so this is display hygiene, not path-traversal defence. The
 * traversal defence is that the name never reaches the filesystem at all.
 */
export function sanitizeFilename(name: string, fallbackExt: string): string {
  const base = name
    .replace(CONTROL_CHARS_GLOBAL, '')
    .replace(/[\\/]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/["\r\n]/g, '')
    .trim()
    .slice(0, 120);

  const cleaned = base.replace(/^[.\s]+/, '') || `document.${fallbackExt}`;
  return cleaned.includes('.') ? cleaned : `${cleaned}.${fallbackExt}`;
}
