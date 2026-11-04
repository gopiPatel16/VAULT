# Vault

A self-hosted secure document vault. Authorised client devices can browse,
search and download highly sensitive personal documents remotely; the
infrastructure behind the service stays invisible to them.

The full design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Read that
before changing anything security-relevant — most of the decisions here look
arbitrary until you know what they are defending against.

## Where the project stands

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture | done |
| 2 | Database, authentication, devices, audit | done |
| 3 | Document storage, upload, search, streaming | done |
| 4 | Document Master Password, grants, invalidation | done |
| 5 | Client website + admin console | done |
| — | Public access from anywhere (tunnel) | done |
| — | Flutter phone apps | written; deferred until later |
| 6 | Security hardening pass | partly done (see below) |
| 7 | Test suite | 106 backend + 31 client + 1 end-to-end, green |
| — | Admin console | built, and walked through in a real browser |

The backend is complete and tested. The Flutter client analyses clean, and the
whole two-layer flow has been exercised end to end against a live backend using
the client's own code — enrol, sign in, browse, get refused without the master
password, unlock, download byte-identically, re-lock.

The administrator console is built and was driven through a real browser
against the live backend: sign in with TOTP, dashboard, client management,
setup-code issuance, and a destructive action correctly interrupted by the
step-up prompt and completed after re-authentication.

The Flutter UI itself has now been rendered and driven two ways without a
simulator: nine widget tests that build the real screens headlessly, and a
release web build served same-origin and clicked through against the live
backend — enrol, sign in, browse, refused without the master password, unlock,
and the document actually decrypted and loaded.

## The two security layers

Everything in this codebase follows from one rule — **being logged in is not
permission to read a document**.

```
Client authentication  →  browse and search METADATA
        +
Document Master Password  →  read document BYTES
```

The master password is set and changed **only** by the administrator. Clients
can submit it for verification and nothing else. There is no route anywhere in
the application that lets a client set, change, reset, recover or read it —
absent, not permission-gated.

## Running it

Requires Node 22+ and PostgreSQL 16.

```bash
cd backend && npm install
```

Generate the four secrets and write a `.env` (start from `.env.example`):

```bash
npm run gen:keys
```

**Back up `STORAGE_KEK` somewhere other than this machine.** Losing it makes
every stored document permanently unreadable, and no amount of administrator
access undoes that.

Create the database and apply migrations:

```bash
createdb vault_dev && npx prisma migrate deploy
```

Create the first administrator. This is a local CLI on purpose — a web
"first-run setup" page is a race that whoever finds the host first can win:

```bash
npm run bootstrap:admin
```

It prints the TOTP secret and recovery codes once. Then start the API:

```bash
npm run start:dev
```

## First-run checklist

1. `npm run bootstrap:admin` — create the administrator, save the TOTP secret.
2. Sign in to the admin API and **set the Document Master Password**. Until it
   is set the vault fails closed: no document contents are readable by anyone.
3. Create a client, grant it category access, issue an enrolment code.
4. Enrol a device with that code, then sign in with the client password.

## Tests

```bash
createdb vault_test && npm test
```

The suite is deliberately adversarial. It asserts, among other things, that a
valid session cannot read a document without the master password; that changing
the master password locks every client out on the next request; that one
client's grant is useless on another's device; that a revoked device stops
working immediately; that an executable renamed `.pdf` is rejected on its magic
bytes; that a truncated encrypted blob never decrypts; and that a dropped
database or a missing file produces the same `404` as a document that never
existed.

Two suites are worth knowing about specifically:

- `test/security/route-coverage.spec.ts` walks the live router and fails the
  build if any route lacks a scope declaration, or if anything resembling
  password management ever appears outside the admin surface.
- `test/security/leakage.spec.ts` sweeps every endpoint and asserts no response
  ever contains a driver name, framework name, filesystem path or socket error.

```bash
bash scripts/check-forbidden-strings.sh
```

fails the build if infrastructure vocabulary ("server", "offline", "connection
refused") reaches a client-facing string.

## Deployment

`infra/docker-compose.yml` brings up Postgres, the API and Caddy. Postgres has
no published port; the API binds inside the container network; Caddy is the only
public listener and is configured to 404 the administrator routes on the public
hostname.

Prefer a Cloudflare Tunnel or Tailscale over forwarding a port from a
residential connection, so the origin address never appears in DNS.

**Stated plainly:** network-level metadata cannot be fully hidden. An observer
on the client's network sees the destination IP, the TLS SNI hostname, and
traffic timing. This design minimises information leakage; it does not promise
invisibility.

## Known scope limits

Honest list of what is deliberately not done yet:

- **The client has not been run on iOS or Android hardware.** It has been
  rendered headlessly and in a browser, but no simulator was available, so
  platform-specific behaviour (Keychain, StrongBox, `FLAG_SECURE`) is
  unexercised.
- **The device key is software-held, not hardware-held.** It lives in Keychain /
  Android Keystore-backed storage, which protects it at rest but does not make
  it unextractable on a rooted device. The protocol already speaks P-256
  precisely so that moving to Secure Enclave / StrongBox is a re-enrolment
  rather than a wire-format change. See `lib/core/device_key_store.dart`.
- **Server-side PDF rasterisation for preview** is deferred; preview streams the
  document inline behind the same guard chain. It becomes required if a browser
  client is ever added. (ARCHITECTURE §7.4)
- **Rate limiting and the signature nonce cache are per-process.** Correct for
  the single-node target; a multi-instance deployment needs Redis or the limits
  multiply by the instance count. Master-password brute-force protection does
  not depend on this — it is backed by a durable table.
- **Client uploads are not implemented.** Admin-only ingestion removes the
  largest attack surface at no cost to the MVP.
- **Not zero-knowledge.** Document keys are wrapped by a server-held KEK, not
  derived from the master password. An attacker with the server *and* the KEK
  can read documents. The master password protects against a compromised
  client, a stolen session and a lost device — not a compromised server. The
  trade-off and its alternative are set out in ARCHITECTURE §7.3.

## The client

The repository carries `lib/`, `test/` and `pubspec.yaml` but no `ios/` or
`android/` directories — those are generated scaffolding, not source, and they
are large. Generate them once:

```bash
cd client-app
flutter create . --platforms=ios,android
flutter pub get
flutter run --dart-define=VAULT_BASE_URL=https://your-host
```

`flutter create` on an existing directory adds the platform folders and leaves
`lib/` alone.

The address is a compile-time constant, not a setting. There is no screen in
the client that displays or edits an address, because an address is
infrastructure.

Worth reading for what is absent: `lib/features/settings_screen.dart` has no
master-password section, `sign_in_screen.dart` has no "forgot password" link,
and `vault_repository.dart` has no method that could change, reset or read the
master password. `scripts/check-forbidden-strings.sh` fails the build if any of
those ever appear.

```bash
cd client-app && flutter test
```

covers the parts worth pinning: the canonical signing string (against digests
generated from the backend's own implementation, so the two cannot drift), the
unlock-window state machine, and the P-256 public-key encoding.

### Seeing the UI without a simulator

`test/widget/screens_test.dart` builds the real screens with `testWidgets` and
asserts the guarantees that are about *absence* — that settings offers no
master-password management, that the failure screen says only "404 / Unable to
load this page", that an unexpected exception produces no more detail than an
expected one, and that Preview and Download simply do not exist until a grant
is held. Absence is exactly what a source review skims past, so it is asserted
against the rendered widget tree.

For an actual visual, the client also builds for web:

```bash
cd client-app
flutter build web --release --dart-define=VAULT_BASE_URL=
node tool/serve-web-dev.mjs        # app + API on one origin, port 8095
```

The proxy exists because the backend's CORS allowlist deliberately admits only
the administrator console — the real client is native and makes no
cross-origin requests. Rather than widen production CORS for a development
convenience, the proxy puts the app and the API on the same origin, which is
also what Caddy does in deployment. **Web is a verification aid, not a
supported target**: a browser cannot hold a hardware-backed device key, which
is why the architecture rejected it as the primary client.

### Cross-language signing check

The client and backend are different languages, different crypto libraries and
different default ECDSA signature encodings. The failure mode when they
disagree is a generic 401 on every request with nothing in either log
explaining it, so it is pinned explicitly:

```bash
cd client-app && flutter test test/interop_vector_test.dart   # writes the vector
cd ../backend && npx jest test/security/client-interop.spec.ts # verifies it
```

The client's real key store signs a request; the backend's real
`SignatureService` verifies it, and is checked to reject a tampered message and
a flipped signature bit. This caught a genuine defect during development: the
client's first crypto library threw `UnimplementedError` from pure-Dart ECDSA
key generation, meaning no device could ever have enrolled. Static analysis was
clean.

## The administrator console

```bash
cd admin-web && npm install
npm run dev    # http://localhost:5173
```

Set `VITE_API_BASE` if the API is not on `http://127.0.0.1:3100`. The backend's
`ADMIN_ORIGIN` must match the console's origin exactly, or CORS will refuse it.

The session token is held in a module variable and nowhere else — not
localStorage, not a cookie. XSS here cannot lift a token out of storage, CSRF
does not apply because there is no cookie, and a page refresh signs you out.
That last one is a real cost, and the right trade for the one console that can
change the Document Master Password.

Destructive actions (change the master password, delete a document, revoke a
client, invalidate all document sessions) are interrupted by a step-up prompt
for both factors, however recently you signed in.

## Layout

```
backend/          NestJS API — the whole security model lives here
  src/common/     guards, crypto, the error sanitiser
  src/modules/    auth · devices · documents · vault (DMP) · admin · audit
  prisma/         schema and migrations
  scripts/        bootstrap-admin, admin-recovery, gen-keys
  test/security/  the adversarial suite
docs/             ARCHITECTURE.md
infra/            docker-compose, Caddyfile
admin-web/        React + Vite administrator console (private network only)
  src/api.ts      fetch wrapper; token in memory only
  src/views/      dashboard · documents · clients · security · step-up
scripts/          check-forbidden-strings.sh
client-app/       Flutter client
  lib/core/       device key, request signing, failure flattening, grant holder
  lib/features/   enrolment · sign-in · home · document · settings
  test/           canonical-request, grant, and key-encoding tests
```
