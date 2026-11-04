/**
 * The browser's device identity.
 *
 * Every request is signed with a P-256 key in addition to carrying the session
 * token, so a token copied out of storage is not by itself a usable credential
 * — the same property the native client has.
 *
 * The key is generated with `extractable: false` and the CryptoKey object
 * itself is stored in IndexedDB. That is the important detail: JavaScript on
 * this page can *use* the key to sign, but there is no API that will hand back
 * the private key bytes. Cross-site scripting on this page could ask for a
 * signature; it could not steal the key and sign elsewhere later.
 *
 * This is weaker than a phone's Secure Enclave — a browser key does not
 * survive "clear site data", and a compromised browser can still sign while
 * the tab is open. It is meaningfully stronger than a bearer token alone.
 */

const DB_NAME = 'vault';
const STORE = 'device';
const KEY_ID = 'signing-key';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('storage unavailable'));
  });
}

function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(new Error('storage failed'));
      }),
  );
}

/** SPKI DER prefix for an uncompressed P-256 public key — the form the
 *  backend parses. WebCrypto exports SPKI directly, so nothing is assembled
 *  by hand here; this constant only documents the expected shape. */
export const P256_SPKI_LENGTH = 91;

let cached: CryptoKeyPair | null = null;

async function loadOrCreate(): Promise<CryptoKeyPair> {
  if (cached) return cached;

  const stored = await idb<CryptoKeyPair | undefined>('readonly', (s) => s.get(KEY_ID));
  if (stored?.privateKey) {
    cached = stored;
    return stored;
  }

  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    // Not extractable. This is the whole point of doing it this way.
    false,
    ['sign', 'verify'],
  );

  await idb('readwrite', (s) => s.put(pair, KEY_ID));
  cached = pair;
  return pair;
}

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

/** Base64 SPKI DER — what enrolment sends and the backend stores. */
export async function publicKeyB64(): Promise<string> {
  const { publicKey } = await loadOrCreate();
  return toBase64(await crypto.subtle.exportKey('spki', publicKey));
}

/** Raw r‖s (IEEE P1363), which the backend accepts alongside DER. */
export async function sign(canonical: string): Promise<string> {
  const { privateKey } = await loadOrCreate();
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(canonical),
  );
  return toBase64(signature);
}

/** Used when the service says this device is no longer authorised. */
export async function forgetDevice(): Promise<void> {
  cached = null;
  await idb('readwrite', (s) => s.delete(KEY_ID));
}

/**
 * The string the backend rebuilds and verifies. Must match byte for byte:
 *
 *   v1
 *   <METHOD>
 *   <path with query>
 *   <unix milliseconds>
 *   <nonce>
 *   <lowercase hex sha256 of the exact request body>
 */
export async function canonicalRequest(
  method: string,
  pathWithQuery: string,
  timestampMs: number,
  nonce: string,
  rawBody: string,
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    'v1',
    method.toUpperCase(),
    pathWithQuery,
    String(timestampMs),
    nonce,
    hex,
  ].join('\n');
}
