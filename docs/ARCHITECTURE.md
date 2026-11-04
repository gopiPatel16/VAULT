# Vault — Architecture Proposal (Phase 1)

Status: **approved and built.** Backend (`backend/`, 106 tests), Flutter client
(`client-app/`, 22 tests plus a live end-to-end run) and administrator console
(`admin-web/`) are all implemented. The Flutter UI has not been run on a device
— no Xcode on the build machine — but everything beneath it has been exercised
against a live backend.

Sections marked *"refined during implementation"* record where building the
thing changed the design. Everything else stands as approved.

Core invariants that every later decision must preserve:

1. The Administrator solely controls the Document Master Password (DMP).
2. Clients may only *submit* the DMP for verification.
3. Clients cannot change, reset, recover, view, or manage the DMP.
4. The infrastructure is invisible to clients.
5. All authorization is enforced by the backend.
6. Security beats convenience.

---

## 1. Recommended Technology Stack

### 1.1 Client — **Flutter (Dart)**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Flutter** | One codebase → iOS, Android, macOS, Windows, Linux. First-class access to Keychain / Android Keystore / StrongBox via `flutter_secure_storage` + platform channels. Compiled AOT — reverse engineering is harder than a JS bundle. Precise control over rendering (no browser cache/history leaking documents). | Dart is a second language in the project. Flutter Web is heavy and loses the secure-hardware story. | **Chosen** |
| React Native | Shared JS/TS with backend, large ecosystem | JS bundle is trivially readable; Hermes bytecode only mildly better; secure-hardware access via third-party bridges | Rejected |
| Native iOS + Android | Best possible security primitives (Secure Enclave, App Attest, Play Integrity) | 2× implementation and maintenance cost for a single-operator project | Rejected for MVP; Flutter can call these via channels if needed later |
| Web SPA | Zero install, easy updates | No hardware-backed device key, no attestation, browser cache/history/print pipeline all leak document content, XSS steals grants | Rejected as the primary client |

**Decision:** Flutter for the client, mobile-first, desktop as a build target. If a browser client is ever required, it becomes a *separate, more restricted* surface — not a reskin of the trusted client.

Note this is a security decision, not a preference: the client holds a device private key that must live in hardware-backed storage, and a browser cannot provide that.

### 1.2 Backend — **NestJS (TypeScript) on Fastify**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **NestJS + Fastify** | Guard/interceptor pipeline expresses the two-layer authorization model *declaratively* — a global deny-by-default guard plus explicit `@RequiresDocumentGrant()` per route means "forgot to protect an endpoint" becomes a compile-time-visible omission rather than a silent hole. Strong DTO validation (`class-validator`), mature `argon2`, `helmet`, rate-limit libs. Same language as the admin SPA. Excellent streaming. | Node memory footprint; npm supply-chain surface. | **Chosen** |
| FastAPI (Python) | Superb ergonomics, Pydantic validation, best future path for OCR/AI (§33 — Tesseract, embeddings) | Dependency-injected layered guards are less structured; async file streaming needs care | **Strong runner-up.** Pick this instead if you prefer Python; the architecture maps 1:1. |
| Go | Single static binary, tiny footprint, ideal for a self-hosted box, no runtime dependency drift | More boilerplate for validation/ORM/migrations; slows MVP | Rejected for MVP |
| Laravel | Great admin scaffolding | PHP process model is awkward for long streaming responses; crypto ergonomics weaker | Rejected |

Supply-chain mitigation for the Node choice: pinned lockfile, `npm audit` + Dependabot in CI, minimal direct dependencies, no post-install scripts (`--ignore-scripts`), production image built from `node:22-alpine` distroless-style with only runtime deps.

### 1.3 Database — **PostgreSQL 16**

- Real concurrency (multiple devices streaming + admin uploading simultaneously).
- `tsvector` full-text search built in → §20 search and §33 full-text/OCR need no new infrastructure later, only a column populated.
- `jsonb` for audit metadata and flexible document metadata.
- Strong constraint support (partial unique indexes, check constraints, FKs) — schema-level enforcement of "one DMP row", "one active grant per device", etc.

**SQLite trade-off:** for a genuinely single-box deployment SQLite + FTS5 would be simpler (no second service, trivial backup as one file). Rejected because concurrent writers during upload + audit logging is where SQLite starts throwing `SQLITE_BUSY`, and the migration path to Postgres later is a rewrite of the search layer. Postgres in Docker Compose costs one container.

**ORM:** Prisma (typed schema + migrations). Raw SQL for the search query.

### 1.4 Storage — private encrypted blob store behind an interface

- `StorageDriver` interface: `put(stream) → key`, `get(key) → stream`, `delete(key)`, `stat(key)`.
- MVP driver: local disk, root path from server config, **never** in the web root, never served statically.
- Object key: `sha256[0:2]/sha256[2:4]/<uuid>.bin` — opaque, no original filename, no category in the path.
- Envelope encryption at rest (see §7).
- Swapping in S3/MinIO/Backblaze later touches one file.

### 1.5 Edge — **Caddy** reverse proxy

Automatic TLS/HTTPS, trivial header stripping and HSTS, generic error pages. Terminates TLS; the API binds to loopback only.

### 1.6 Admin interface — **React + Vite SPA, separate origin, not publicly exposed**

Served on a distinct hostname/port, bound to LAN or reachable only over a private overlay network (Tailscale/WireGuard). Never bundled with, and never routable from, the client app surface.

### 1.7 Stack summary

```
Client        Flutter 3.x (Dart), Riverpod, dio, flutter_secure_storage
Admin UI      React 18 + Vite + TypeScript (private network only)
API           NestJS 10 on Fastify, TypeScript, Zod/class-validator
DB            PostgreSQL 16 + Prisma
Storage       Local encrypted blobs behind StorageDriver
Crypto        Argon2id (DMP + passwords), AES-256-GCM (files), ECDSA P-256 (device keys)
Edge          Caddy (TLS, HSTS, header scrubbing)
Runtime       Docker Compose
```

---

## 2. System Architecture

```
                       CLIENT APPLICATIONS
                  iOS · Android · macOS · Windows
                              │
                     HTTPS (TLS 1.3 only)
                              │
                              ▼
                  ┌───────────────────────┐
                  │   Caddy reverse proxy │  strips Server headers,
                  │   TLS · HSTS · CSP    │  generic 404 error pages
                  └───────────┬───────────┘
                              │ loopback only
                              ▼
        ┌───────────────────────────────────────────────┐
        │              API (NestJS)                     │
        │                                               │
        │  Global guards (deny by default):             │
        │    1. RateLimitGuard                          │
        │    2. ClientAuthGuard      (Layer 1)          │
        │    3. DeviceStatusGuard                       │
        │    4. DocumentGrantGuard   (Layer 2, opt-in)  │
        │    5. ResourceAuthzGuard   (per-document)     │
        │                                               │
        │  ┌──────────┬──────────┬─────────┬─────────┐  │
        │  │   Auth   │Documents │ Vault   │  Audit  │  │
        │  │  module  │  module  │(DMP)    │ module  │  │
        │  └──────────┴──────────┴─────────┴─────────┘  │
        │                                               │
        │  ADMIN MODULES — separate router, separate    │
        │  token audience, private-network binding      │
        │  ┌──────────┬──────────┬─────────┬─────────┐  │
        │  │AdminAuth │  Docs    │ Clients │Security │  │
        │  └──────────┴──────────┴─────────┴─────────┘  │
        └───────────────┬───────────────┬───────────────┘
                        │               │
                        ▼               ▼
              ┌──────────────┐   ┌──────────────┐
              │ StorageDriver│   │  PostgreSQL  │
              │  (encrypted  │   │  metadata ·  │
              │   blobs)     │   │  audit · DMP │
              └──────────────┘   └──────────────┘
```

The client never addresses the database or filesystem. Every byte it receives passes through an authorization decision.

---

## 3. Client Architecture

### 3.1 Screens (MVP)

```
Splash → Enrollment (first launch only) → Sign in → Home
Home ─┬─ Search
      ├─ Categories → Document list
      ├─ Favorites
      └─ Recently added
Document list → Document details (metadata only)
Document details → [Unlock Document] → DMP prompt → Preview / Download
Settings → device name, biometric lock, sign out
```

**Deliberately absent from the client — and from the codebase, not merely hidden by a flag:** change password, forgot password, reset password, recover password, set password, master-password settings, any connectivity/status indicator, any diagnostic screen. There is no route, no widget, and no API client method for any of them. §13 is enforced by non-existence.

### 3.2 Layers

```
lib/
  core/       result types, error mapping, secure storage, device key mgmt
  data/       api client (dio), DTOs, repositories
  domain/     entities, use cases
  features/   auth · home · search · categories · document · settings
  ui/         design system, widgets
```

### 3.3 Client-side security rules

- The DMP is held in a `String` for the duration of one request, never written to disk, never logged, never placed in a text field with autofill/suggestions enabled, never in a `TextEditingController` that survives the route.
- The document grant token lives **in memory only**. Killed on app background (configurable), on app termination, on sign-out.
- The client stores: refresh token (secure storage), device private key (Keychain/Keystore, non-exportable), device id, cached *metadata* only.
- **Preview and downloads are written to an app-private, OS-encrypted directory and deleted when the grant expires.** No writes to shared Downloads/Photos without an explicit user action per file.
- Screenshot suppression (`FLAG_SECURE` on Android, screen-capture overlay on iOS) on document preview screens.
- Certificate pinning to the deployment's leaf/intermediate, with a documented rotation procedure.
- No client-side validation is treated as a security control. Ever.

### 3.4 The client has no concept of "the server"

There is no `ServerStatus`, no health poll, no reachability check, no "reconnecting" state, no exposed base URL in any user-visible surface. The networking layer collapses every transport-level failure into a single `ServiceUnavailable` result (§14).

---

## 4. Administrator Architecture

Completely separate surface. Not a role toggle inside the client.

- **Separate origin/port** (e.g. `admin.vault.internal`), bound to the private network. Not reachable from the public hostname the clients use.
- **Separate credential store** (`admins` table) — no shared table with clients, so a client-account bug cannot become admin access.
- **Mandatory TOTP 2FA** for admin login. Non-negotiable: the admin can change the DMP.
- **Structurally different token types.** A client access token is a signed JWT; an administrator session token is 256 bits of randomness looked up in `admin_sessions`. A client token will never be found in that table and an admin token will never verify as a JWT, so the separation does not depend on anyone remembering to check an audience claim. The client JWT additionally carries `aud: vault:client`, checked strictly.
- **Separate cookie name, path, and SameSite=Strict**; admin uses cookies (browser), clients use bearer + device signature (native).
- **Step-up re-authentication** for the destructive operations: change DMP, revoke client, delete document, invalidate all grants. Password + TOTP again, regardless of session age.
- Optionally gated behind mTLS or an overlay network — recommended.

### Admin features (MVP)

| Area | Capabilities |
|---|---|
| Dashboard | Document count, storage usage, recent security events, active clients/devices, active grant count |
| Documents | Upload, rename, delete, categorize, tag, move, search |
| Clients | Create client, issue enrollment code, list devices, revoke device, revoke client, kill sessions |
| Security | Set DMP, change DMP, configure grant timeout, invalidate all grants, view audit log |

---

## 5. Backend Architecture

### 5.1 Module map

```
src/
  main.ts                 bootstrap, Fastify, helmet, global filters
  common/
    guards/               rate-limit, client-auth, device-status,
                          document-grant, admin-auth, admin-stepup
    filters/              GlobalExceptionFilter (the sanitizer)
    interceptors/         audit, request-id, response-shaping
    crypto/               argon2, aes-gcm envelope, token hashing, ecdsa p-256
    errors/               AppError + fixed public error-code enum
  modules/
    auth/                 enrollment, login, refresh, logout
    devices/              device identity, signature verification
    documents/            metadata CRUD, search, streaming
    vault/                DMP verification, grant issue/validate/revoke
    admin/                admin auth, docs, clients, security settings
    audit/                append-only hash-chained log
    storage/              StorageDriver interface + LocalDiskDriver
```

### 5.2 The guard chain (the heart of the security model)

Every route is denied unless it declares what it needs. `APP_GUARD` order:

```
Request
  │
  ├─ RequestIdInterceptor ......... attaches correlation id
  ├─ RateLimitGuard ............... per-IP, per-device, per-route class
  ├─ RouteScopeGuard .............. is this route @Public / @Client / @Admin ?
  ├─ ClientAuthGuard .............. valid access token, aud=client, not expired
  ├─ DeviceSignatureGuard ......... request signed by the enrolled device key
  ├─ DeviceStatusGuard ............ device active, client active, session live
  ├─ DocumentGrantGuard ........... only on @RequiresDocumentGrant routes:
  │                                 grant exists, unrevoked, unexpired,
  │                                 dmp_version == current, bound to this
  │                                 device + session
  ├─ ResourceAuthzGuard ........... this client may access THIS document
  └─ Handler
```

A route with no decorator is rejected by `RouteScopeGuard`. Adding an endpoint and forgetting to protect it fails closed.

### 5.3 Two-layer separation, restated in code terms

| | Layer 1 — Client Authentication | Layer 2 — Document Master Password |
|---|---|---|
| Question | Is this an authorized client device? | Is this client *currently* authorized to read document contents? |
| Credential | Client password + device key signature | Document Master Password |
| Artifact | Access token (10 min) + refresh token | Document grant token (5 min default) |
| Unlocks | Metadata: browse, search, titles, sizes, categories, tags | Bytes: preview, download |
| Controlled by | Client (their own account password) | **Administrator only** |

Being logged in never implies document access. `GET /documents/{id}/content` with a perfectly valid session and no grant returns `404`.

---

## 6. Database Schema

**Refined during implementation — all timestamps are `timestamptz`.** The
schema originally used Prisma's default `DateTime`, which maps to `timestamp`
*without* time zone. The application wrote UTC while Postgres `now()` returned
local time, so the two disagreed by the machine's UTC offset. Nothing in the
application misbehaved — it was self-consistent — but any operator running SQL
against `expires_at` on `document_grants` or `sessions`, or any future
database-level cleanup job, would have been silently working with shifted
values. On expiry columns that is security-relevant. Migration
`20260812000000_timestamptz` converts every column with an explicit
`USING ... AT TIME ZONE 'UTC'` so existing rows keep their real instants.



```sql
-- ─── Administrators ────────────────────────────────────────────────
admins (
  id              uuid pk,
  username        citext unique not null,
  password_hash   text not null,          -- argon2id
  totp_secret_enc bytea not null,         -- encrypted with server KEK
  totp_enabled    boolean not null default false,
  recovery_code_hashes text[] not null,   -- single-use, argon2id, §14
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
)

admin_sessions (
  id uuid pk, admin_id uuid fk, token_hash text not null,
  issued_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  stepup_at timestamptz, ip_hash text
)

-- ─── Clients and devices ───────────────────────────────────────────
clients (
  id uuid pk,
  display_name    text not null,
  login_id        citext unique not null,
  password_hash   text not null,          -- argon2id (Layer 1 only)
  status          text not null default 'active',   -- active|suspended|revoked
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
)

devices (
  id uuid pk,
  client_id       uuid fk -> clients,
  name            text not null,          -- "iPhone", "MacBook"
  platform        text not null,
  public_key      bytea not null,         -- P-256 SPKI DER, hardware-backable
  status          text not null default 'active',  -- active|revoked
  enrolled_at     timestamptz not null default now(),
  last_seen_at    timestamptz,
  revoked_at      timestamptz
)

enrollment_codes (
  id uuid pk, client_id uuid fk, code_hash text not null,
  expires_at timestamptz not null, used_at timestamptz,
  created_by_admin uuid fk -> admins
)

sessions (                                 -- refresh-token sessions
  id uuid pk, device_id uuid fk, client_id uuid fk,
  refresh_token_hash text not null,        -- sha256, rotating
  rotated_from uuid, issued_at timestamptz, expires_at timestamptz,
  revoked_at timestamptz, reuse_detected_at timestamptz
)

-- ─── Documents ─────────────────────────────────────────────────────
categories (id uuid pk, slug citext unique, name text, sort_order int)

documents (
  id              uuid pk default gen_random_uuid(),  -- opaque, non-sequential
  title           text not null,
  original_filename text not null,
  mime_type       text not null,          -- server-detected, not client-supplied
  size_bytes      bigint not null,
  sha256          bytea not null,
  category_id     uuid fk -> categories,
  storage_key     text not null,          -- opaque; NEVER leaves the backend
  enc_dek         bytea not null,         -- DEK wrapped by server KEK
  enc_nonce       bytea not null,
  enc_tag         bytea not null,
  document_date   date,                   -- "created date" of the real doc
  uploaded_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  uploaded_by     uuid fk -> admins,
  search_vector   tsvector                -- title, filename, tags, (future OCR)
)

tags (id uuid pk, name citext unique)
document_tags (document_id uuid fk, tag_id uuid fk, pk(document_id, tag_id))

-- Default deny. A client sees a document only via an explicit grant row.
client_category_access (client_id uuid fk, category_id uuid fk, pk(...))
client_document_access (client_id uuid fk, document_id uuid fk,
                        mode text not null default 'read', pk(...))

favorites (client_id uuid fk, document_id uuid fk, pk(client_id, document_id))

-- ─── Document Master Password ──────────────────────────────────────
vault_secret (
  id              int pk default 1 check (id = 1),   -- exactly one row
  dmp_hash        text,                   -- argon2id(password || pepper)
  dmp_algo        text not null default 'argon2id',
  dmp_params      jsonb not null,
  dmp_version     int  not null default 0,           -- bumped on every change
  grant_ttl_seconds int not null default 300,        -- 60|300|900|1800
  configured_at   timestamptz,
  updated_at      timestamptz,
  updated_by      uuid fk -> admins
)

document_grants (                          -- Layer 2 authorizations
  id uuid pk,
  token_hash      bytea not null unique,   -- sha256 of opaque 256-bit token
  client_id       uuid fk, device_id uuid fk, session_id uuid fk,
  dmp_version     int not null,            -- must equal current to be valid
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz
)
create index on document_grants (expires_at) where revoked_at is null;

dmp_attempts (                             -- brute-force accounting
  id bigserial pk, client_id uuid, device_id uuid, ip_hash text,
  at timestamptz not null default now(), success boolean not null
)

-- ─── Audit ─────────────────────────────────────────────────────────
audit_log (
  id          bigserial pk,
  at          timestamptz not null default now(),
  actor_type  text not null,               -- admin|client|system
  actor_id    uuid,
  device_id   uuid,
  event       text not null,               -- enum, see §26
  target_type text, target_id uuid,
  result      text not null,               -- success|failure
  ip_hash     text,                        -- hashed, not raw
  metadata    jsonb not null default '{}', -- never secrets, never contents
  prev_hash   bytea,                       -- tamper-evident chain
  entry_hash  bytea not null
)
```

Notes:
- Document ids are random UUIDv4/v7 — enumeration (`/document/123` → `/document/124`) is meaningless. This is *defense in depth only*; the real control is `ResourceAuthzGuard`.
- `storage_key` never appears in any client-facing response or DTO. Enforced by explicit response serializers, not by `delete obj.storage_key`.
- `vault_secret` is a single enforced row — there cannot be a second, client-created master password.

---

## 7. Document Storage Design

### 7.1 Write path (admin upload)

```
Admin upload (multipart, size-capped, admin-authenticated)
   ↓
Stream to a private temp dir on the same filesystem (no /tmp world-readable)
   ↓
Enforce max size (default 100 MB) while streaming — abort past the cap
   ↓
Sniff real MIME from magic bytes (file-type), IGNORE the client extension
   ↓
Reject unless in allowlist: pdf, png, jpeg, webp, heic, docx, xlsx, txt
   ↓
Sanitize filename for DISPLAY only (never used as a path component)
   ↓
Compute sha256 → duplicate detection hook (§33)
   ↓
Generate random 256-bit DEK → AES-256-GCM encrypt → write to storage_key
   ↓
Wrap DEK with server KEK → store enc_dek/enc_nonce/enc_tag in DB
   ↓
Insert metadata row · index search_vector · audit log · delete temp file
```

Path traversal is structurally impossible: the client-supplied filename is **never** a path component. `storage_key` is generated server-side from a UUID.

### 7.2 Read path

```
GET /api/v1/documents/{id}/content
   ↓ guard chain (§5.2) — all five layers
Look up storage_key from DB by the authorized document id
   ↓
Unwrap DEK with server KEK
   ↓
Stream decrypt → HTTP response
Headers: Content-Type: <exact detected type>
         Content-Disposition: attachment; filename="<sanitized>"
         X-Content-Type-Options: nosniff
         Cache-Control: no-store, private
         Referrer-Policy: no-referrer
```

No static file serving is configured anywhere in the stack. `/storage/...` does not exist as a route. There is no signed-URL escape hatch to object storage.

### 7.3 Encryption-at-rest key policy — an explicit decision (§14)

**The file encryption key is NOT derived from the Document Master Password.**

Files are encrypted with per-file DEKs wrapped by a server-held KEK (env var / OS keyring / optional TPM). The DMP is an **authorization** credential, not a **key-derivation** credential.

The on-disk container is a **framed AEAD**: 64 KiB plaintext frames, each with its own AES-256-GCM tag, with the frame counter and an end-of-stream flag bound into the AAD. A single-tag GCM blob can only be authenticated after its last byte, which would mean streaming unverified plaintext to a client for the whole of a large transfer. Framing authenticates as it goes and makes byte flips, frame reordering, cross-document splicing and truncation all detectable — see `test/security/envelope.spec.ts`.

| | DMP-derived keys (zero-knowledge) | Server-held KEK (**recommended**) |
|---|---|---|
| Server compromise reads documents | No | Yes |
| DMP change | Must re-encrypt/re-wrap every file | Instant, `dmp_version++` |
| Recovery if DMP is lost | Documents are permanently lost | Admin can re-set the DMP |
| Server-side preview rendering, OCR, full-text search (§20, §33) | Impossible | Works |
| Recovery silently bypassing encryption (§14 hazard) | N/A | **Explicitly acknowledged:** admin recovery *does* restore document access, because encryption is not bound to the DMP |

I am recommending the server-held KEK and stating the consequence plainly rather than implying zero-knowledge the design does not deliver: **an attacker with full server access plus the KEK can read documents without the DMP.** The DMP protects against a compromised *client*, a stolen *session*, and a lost *device* — not against a compromised *server*.

If you want true zero-knowledge, say so now and I will design a hardened mode where a DMP-derived key wraps the DEKs — accepting that losing the DMP means losing every document forever, and that OCR/full-text search/server-side preview become impossible. That is a foundational choice; it cannot be retrofitted cheaply.

### 7.4 Preview

`GET /documents/{id}/preview` streams the decrypted document inline, behind exactly the same guard chain as download — preview is not a weaker door, and it carries `Content-Type` from server-side detection plus `nosniff`, `no-store` and `no-referrer`.

**Scope note, stated plainly:** server-side rasterisation of PDFs to sanitised images is *not* implemented in this pass. It requires a rendering binary (poppler's `pdftoppm`) as a deployment dependency, and its security value is specific to a browser client that would otherwise execute PDF JavaScript. The MVP client is Flutter and renders PDFs in a native widget, so the benefit does not yet apply. This is carried as a Phase 6 hardening item, and it becomes required the moment a browser client is added.

---

## 8. Authentication Flow (Layer 1)

### 8.1 Device enrollment (first launch)

```
Administrator                          Client device
    │                                       │
    ├─ creates client account               │
    ├─ issues one-time enrollment code ────►│  (out of band, 15-min TTL)
    │                                       │
    │                    generates P-256 keypair in
    │                    Secure Enclave / StrongBox (non-exportable)
    │                                       │
    │◄── POST /auth/enroll ─────────────────┤
    │    { code, publicKey, deviceName, platform }
    │                                       │
    ├─ verify code hash, unused, unexpired  │
    ├─ create device row (status=active)    │
    ├─ mark code used · audit log           │
    ├──► { deviceId } ─────────────────────►│  device registered, NOT signed in
```

**Corrected during implementation — device keys are ECDSA P-256, not Ed25519.**
This document originally specified Ed25519. That was wrong in a way that
mattered: Apple's Secure Enclave holds only NIST P-256 keys, and Android's
StrongBox is likewise EC/RSA, so an Ed25519 device key could only ever live in
software — protected at rest but loadable into app memory and extractable on a
compromised device, which is precisely the property the device key exists to
deny. P-256 is what makes hardware backing possible at all. The change was made
before any device enrolled; making it later would have meant a wire-format
break and re-enrolling every device.

The MVP client still generates its key in software (see
`client-app/lib/core/device_key_store.dart`); moving it into the Secure Enclave
is now a re-enrolment rather than a protocol change.

**Enrolment confers nothing on its own.** It records the device's public key and stops; the device must still authenticate with the account password to obtain a session. A leaked enrolment code is therefore not a way in — it is one of two things an attacker would need. Device count per client is also capped (default 5) so a leaked code cannot spawn a fleet.

### 8.2 Sign-in and request signing

```
POST /auth/login  { loginId, password, deviceId, ts, nonce, signature }
   ↓ verify device active + client active
   ↓ verify P-256 ECDSA signature over (method|path|ts|nonce|bodyHash)
   ↓ verify argon2id password hash
   ↓ issue access token (JWT, aud=client, 10 min, jti, sid, did)
   ↓ issue rotating refresh token (30 days, hashed in DB)
```

Every subsequent request carries `Authorization: Bearer <access>` **and** a fresh device signature with a timestamp and nonce. Consequences:

- A stolen access token alone is useless without the hardware-held device key (§31: "modify local client storage").
- Replay is blocked by the nonce cache + ±60 s timestamp window (§31: "replay requests").
- Refresh-token reuse detection: presenting a rotated-out refresh token revokes the whole session family and raises a security event.

### 8.3 Revocation

Admin revokes device → `devices.status = 'revoked'` → `DeviceStatusGuard` rejects on the *next request*, plus all sessions and all document grants for that device are deleted immediately. The client receives a generic authorization error and returns to the enrollment screen with no explanation of what happened server-side (§28).

---

## 9. Document Master Password Flow (Layer 2)

### 9.1 Initial configuration — Administrator only

```
Admin authenticates (password + TOTP)
   ↓ Security Settings → Set Document Master Password
   ↓ policy check: min 12 chars, zxcvbn score ≥ 3, not equal to admin password
   ↓ hash = argon2id(password || SERVER_PEPPER)
        m = 64 MiB, t = 3, p = 4          (tunable; calibrated to ~500 ms)
   ↓ store hash, dmp_version = 1, audit log (no password, no hash logged)
```

Until the DMP is configured, **no document content endpoint returns anything** — fail closed, not open.

### 9.2 Client unlock

```
Client selects a document → 🔐 Protected Document → enters DMP
   ↓
POST /api/v1/vault/unlock   { password }     [Layer-1 authenticated]
   ↓
RateLimitGuard: per device 5 / 15 min, per client 10 / 15 min,
                global 30 / 15 min; exponential backoff; lockout after 10
   ↓
argon2.verify(stored_hash, password || pepper)     ← constant-time, server-side
   ↓
record attempt in dmp_attempts · audit log (success/failure, never the password)
   ↓
FAIL → 401 { code: "INVALID_CREDENTIAL" }   ← identical body and timing always
   ↓
SUCCESS → token = randomBytes(32)
          insert document_grants { sha256(token), client, device, session,
                                   dmp_version = current,
                                   expires_at = now + grant_ttl_seconds }
   ↓
200 { grant: "<opaque>", expiresAt, expiresInSeconds }
```

Design points:

- **Opaque server-side token, not a JWT.** A self-contained JWT cannot be globally invalidated without a denylist — which is a server-side lookup anyway. Server-side grants make §12's "invalidate all sessions" a single `UPDATE`.
- **Sent as a header** (`X-Vault-Grant`), never a cookie → CSRF is structurally impossible on this credential.
- **Bound** to client + device + session + `dmp_version`. A grant lifted from one device fails on another.
- **Absolute expiry, no sliding renewal.** Renewing on activity would let a single unlock last all day and defeat §15. Extending requires re-entering the password.
- The client never learns anything about the stored hash, the algorithm parameters, or the password itself.

### 9.3 Using the grant

```
GET /api/v1/documents/{id}/content
Authorization: Bearer <access>
X-Device-Signature: <sig>
X-Vault-Grant: <opaque>
   ↓ ClientAuthGuard · DeviceSignatureGuard · DeviceStatusGuard
   ↓ DocumentGrantGuard:  hash lookup → exists? not revoked? not expired?
                          dmp_version == vault_secret.dmp_version?
                          bound to THIS client + device + session?
   ↓ ResourceAuthzGuard:  does this client have access to THIS document?
   ↓ stream
```

Any failure → `404 { code: "NOT_FOUND" }`. Not 403 — a 403 confirms the document exists and is merely locked, which is an existence oracle (§17, §18).

### 9.4 Password change — Administrator only

```
Admin authenticates → step-up (password + TOTP re-entry)
   ↓ Security → Change Document Master Password
   ↓ Current Master Password → verify against stored hash
   ↓ New Master Password → policy check → Confirm New Master Password
   ↓ TRANSACTION:
       vault_secret.dmp_hash = argon2id(new || pepper)
       vault_secret.dmp_version += 1
       UPDATE document_grants SET revoked_at = now() WHERE revoked_at IS NULL
   ↓ audit log: DMP_CHANGED (no passwords, no hashes)
```

Every client on every device is locked out of contents the instant the transaction commits — the `dmp_version` mismatch alone would do it even if the revocation sweep failed. Two independent mechanisms, deliberately.

### 9.5 What does not exist

There is no client endpoint to set, change, reset, recover, or read the DMP. Not gated by a role check — **absent from the routing table**. `/api/v1/vault/*` exposes exactly one route: `POST /unlock`. A reverse-engineered client reveals no other path because no other path exists.

### 9.6 Timeout

Admin-configurable: 1 / 5 / 15 / 30 minutes. **Default: 5 minutes.** 1 minute makes reading a multi-page document impossible and trains users to keep the password on the clipboard, which is a net security loss; 5 minutes is the security-leaning choice that remains usable. Client shows "Access expires in 5 minutes" and re-prompts on expiry.

---

## 10. Device Authorization Flow

```
Admin: Clients → [Client A] → Devices
        iPhone       last seen 2 min ago    [Revoke]
        MacBook      last seen 3 days ago   [Revoke]
        Android Tab  last seen 1 hour ago   [Revoke]

Revoke →  devices.status = 'revoked'
          DELETE all sessions for the device
          REVOKE all document_grants for the device
          audit: DEVICE_REVOKED

Next request from that device
          ↓
   DeviceStatusGuard → 401 { code: "UNAUTHORIZED" }
          ↓
   Client wipes local state, returns to enrollment
   Message: "This device is not authorized."   ← nothing about infrastructure
```

Devices are hard-capped per client (configurable, default 5) so a leaked enrollment code cannot spawn unlimited devices.

---

## 11. API Endpoint Design

`L1` = client authentication required. `L2` = document grant required. `A` = admin. `S` = admin step-up.

### Client API — `https://<host>/api/v1`

| Method | Path | Layers | Notes |
|---|---|---|---|
| POST | `/auth/enroll` | — | One-time code; heavily rate limited |
| POST | `/auth/login` | — | Password + device signature |
| POST | `/auth/refresh` | — | Rotating; reuse detection |
| POST | `/auth/logout` | L1 | Revokes session + its grants |
| GET | `/auth/me` | L1 | Display name, device name only |
| GET | `/categories` | L1 | Only categories the client can access |
| GET | `/documents` | L1 | **Metadata only.** Paginated, filtered by access |
| GET | `/documents/{id}` | L1 | Metadata only. 404 if not permitted |
| GET | `/search?q=&category=&tags=&type=&from=&to=` | L1 | Metadata only |
| GET | `/favorites` / POST / DELETE `/favorites/{id}` | L1 | |
| **POST** | **`/vault/unlock`** | **L1** | **The only DMP endpoint that exists** |
| POST | `/vault/lock` | L1 | Client-initiated early grant revoke |
| GET | `/vault/status` | L1 + L2 | Returns only `{ expiresAt }` for the caller's own grant |
| GET | `/documents/{id}/preview` | L1 + L2 | Sanitized rendered image |
| GET | `/documents/{id}/content` | L1 + L2 | Streamed download |

That is the entire client-facing surface. No health endpoint, no version endpoint, no metrics, no debug, no upload (see below).

**Client uploads are out of scope for the MVP.** §25 says "if clients are allowed to upload" — they are not. Admin-only ingestion removes the single largest attack surface (malicious file upload) at zero cost to the stated MVP. The upload pipeline in §7.1 is built admin-only and can be opened to clients later behind the same validation.

### Admin API — private network only, `/admin/api/v1`

| Method | Path | Layers |
|---|---|---|
| POST | `/auth/login` (password + TOTP) | — |
| POST | `/auth/stepup` | A |
| GET | `/dashboard` | A |
| GET/POST/PATCH/DELETE | `/documents...` | A (delete: S) |
| POST | `/documents/upload` | A |
| GET/POST | `/clients`, `/clients/{id}/enrollment-code` | A |
| POST | `/clients/{id}/revoke` | A + S |
| GET | `/clients/{id}/devices`, POST `/devices/{id}/revoke` | A |
| POST | `/security/master-password` (set) | A + S |
| PUT | `/security/master-password` (change) | A + S |
| PUT | `/security/grant-ttl` | A |
| POST | `/security/invalidate-all-grants` | A + S |
| GET | `/security/audit-log` | A |

### Uniform response envelope

```jsonc
// success
{ "data": { ... } }

// error — the ONLY shape a client ever sees
{ "error": { "code": "NOT_FOUND", "requestId": "01J8..." } }
```

No `message` field derived from an exception. No `stack`. No `detail`. `requestId` correlates to the protected server log where the real cause lives.

---

## 12. Security Threat Model

Assumed attacker capabilities per §31, and the control for each:

| # | Attack | Control |
|---|---|---|
| 1 | Inspect API requests | TLS + no secrets in transit beyond credentials; DMP is never returned |
| 2 | Modify client requests | All authorization server-side; device signature covers method, path, timestamp, body hash |
| 3 | Reverse-engineer the client | Client contains no secrets, no DMP, no `if password ==`, no admin routes, no storage paths |
| 4 | Modify local client storage | Access token alone is insufficient — device signature requires the hardware-held private key |
| 5 | Call APIs manually | Guard chain is identical regardless of caller; no endpoint trusts a client-set flag |
| 6 | Replay requests | Nonce cache + ±60 s timestamp window; refresh rotation with reuse detection |
| 7 | Brute-force the DMP | Argon2id (~500 ms) + layered rate limits + lockout + audit alerts. Attacker must first hold a valid Layer-1 device session |
| 8 | IDOR | Random UUIDs + explicit per-request `ResourceAuthzGuard` + 404-not-403 |
| 9 | Path traversal | Client filenames are never path components; storage keys are server-generated UUIDs |
| 10 | Malicious upload | Admin-only ingestion, magic-byte MIME detection, allowlist, size cap, no execution, non-web-root storage, ClamAV hook point |
| 11 | Inspect HTTP errors | Single sanitized envelope, fixed code enum, uniform 404s |
| 12 | Inspect response headers | Caddy strips `Server`/`X-Powered-By`; no framework banners; no version headers |
| 13 | Discover infrastructure | §13 below |
| 14 | Steal a document grant | Header-only (no CSRF), memory-only on client, bound to device+session, 5-min absolute expiry |
| 15 | Compromised admin account | TOTP + step-up + lockout + full audit trail + separate network exposure |
| 16 | Timing side channel on DMP | Argon2 verify always runs (dummy verify on missing hash); constant error shape |

**Stated honestly — what this design does *not* defend against:**
- A fully compromised server with KEK access can read all documents (§7.3).
- A rooted/jailbroken device with the app unlocked can exfiltrate what the user is currently viewing.
- Network observers can see that a TLS connection exists to a hostname/IP (§13).

---

## 13. Infrastructure Information-Leakage Prevention

**Backend**
- `Server`, `X-Powered-By`, `Via` stripped at Caddy. No version strings anywhere.
- Debug mode off in production. Stack traces to the protected log file only, never to a response.
- No `/health`, `/metrics`, `/version`, `/status`, `/actuator` on the public listener — bound to loopback for the local monitoring only.
- DB errors, filesystem errors, driver names, connection strings, hostnames, and paths never cross the `GlobalExceptionFilter`.
- Uniform `404` for unauthorized and nonexistent alike.
- Directory listing disabled; no static file middleware registered at all.
- CORS: no origins allowed on the client API (native client needs none); admin API allows exactly its own origin.

**Client**
- No status/connectivity/diagnostic UI of any kind.
- Vocabulary is banned at the lint level: `server`, `home server`, `offline`, `online`, `connection`, `host`, `IP`, `unreachable`, `timeout`, `ECONNREFUSED` are forbidden in user-facing strings. A CI check greps the localization files and fails the build.
- Every transport failure → the same generic screen.

**Deployment recommendation**
Publish through a Cloudflare Tunnel or Tailscale Funnel rather than a port forward on a residential connection. The client then resolves a neutral hostname and the origin address is never in DNS.

**Honest caveat (§24):** network-level metadata cannot be fully hidden. An observer on the client's network sees the destination IP, the TLS SNI hostname, and traffic timing/volume. Response latency can weakly hint at geography. This design *minimizes* leakage; it does not promise invisibility, and I will not claim otherwise in code comments or docs.

---

## 14. Error-Handling Design

Single `GlobalExceptionFilter`. Internal cause → public code mapping:

| Internal reality | HTTP | Public code | Logged internally |
|---|---|---|---|
| DB connection refused | 404 | `NOT_FOUND` | full error + stack + requestId |
| Storage path missing / EACCES | 404 | `NOT_FOUND` | full error |
| Document does not exist | 404 | `NOT_FOUND` | debug |
| Document exists, client not permitted | 404 | `NOT_FOUND` | **warn + audit** |
| Valid session, no document grant | 401 | `GRANT_REQUIRED` | info |
| Grant expired, revoked, or superseded | 401 | `GRANT_REQUIRED` | info |
| DMP incorrect | 401 | `INVALID_CREDENTIAL` | **warn + audit** |
| Invalid/expired access token | 401 | `UNAUTHORIZED` | info |
| Device or client revoked | 401 | `UNAUTHORIZED` | **warn + audit** |
| Rate limit exceeded | 429 | `TOO_MANY_REQUESTS` | warn + audit |
| Validation failure | 400 | `INVALID_REQUEST` | debug |
| Unhandled exception | 500 | `UNAVAILABLE` | **error + stack** |

`GRANT_REQUIRED` is the one code that tells the client something real — it must, so the client knows to show the unlock prompt. It reveals only "you need the master password", which the user already knows.

**Refined during implementation.** The grant is validated *before* the document is looked up, so `GRANT_REQUIRED` is purely a statement about the caller's credential and never about the resource. A caller without a valid grant receives byte-identical responses for a document that exists and one that does not, which means the endpoint still cannot be used to enumerate the vault — the property the original 404-for-everything rule was protecting. Once a valid grant *is* presented, an unauthorised or absent document is a plain `404`. `test/security/document-access.spec.ts` asserts both halves.

**Client-side mapping:**

```dart
// Every one of these produces the SAME screen.
ECONNREFUSED · DNS failure · TLS handshake failure · timeout ·
502 · 503 · 504 · 500 · malformed response
      ↓
   ServiceUnavailableFailure
      ↓
   ┌──────────────────────────┐
   │           404            │
   │      Page Not Found      │
   │                          │
   │  Unable to load this     │
   │  page.                   │
   │                          │
   │        [ Retry ]         │
   └──────────────────────────┘
```

The client cannot distinguish "the backend is down" from "this document does not exist" from "you are not authorized" — because it is not told.

---

## 15. Project Directory Structure

```
vault/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── THREAT-MODEL.md
│   ├── DEPLOYMENT.md
│   └── ADMIN-RUNBOOK.md
├── backend/
│   ├── prisma/{schema.prisma,migrations/,seed.ts}
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── config/            typed env schema, fail-fast validation
│   │   ├── common/
│   │   │   ├── guards/        rate-limit · client-auth · device-signature
│   │   │   │                  device-status · document-grant · resource-authz
│   │   │   │                  admin-auth · admin-stepup
│   │   │   ├── decorators/    @Public @ClientRoute @AdminRoute
│   │   │   │                  @RequiresDocumentGrant @RequiresStepUp
│   │   │   ├── filters/       global-exception.filter.ts  ← the sanitizer
│   │   │   ├── interceptors/  request-id · audit · serializer
│   │   │   ├── errors/        app-error.ts · public-error-codes.ts
│   │   │   └── crypto/        argon2 · aes-gcm-envelope · ecdsa-p256 · tokens
│   │   ├── modules/
│   │   │   ├── auth/          enrollment · login · refresh · sessions
│   │   │   ├── devices/
│   │   │   ├── documents/     metadata · search · streaming · preview
│   │   │   ├── vault/         dmp.service · grant.service   ← Layer 2
│   │   │   ├── storage/       storage.driver.ts · local-disk.driver.ts
│   │   │   ├── audit/
│   │   │   └── admin/         auth · documents · clients · security
│   │   └── jobs/              grant-sweeper · audit-chain-verify
│   └── test/
│       ├── unit/
│       └── security/          ← the tests that matter most (§17)
├── admin-web/                 React + Vite SPA (private network only)
│   └── src/{pages,features,api,components}/
├── client-app/                Flutter
│   └── lib/{core,data,domain,features,ui}/
├── infra/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── .env.example           documented; never a real secret in git
└── scripts/
    ├── bootstrap-admin.ts     CLI-only first admin creation
    └── check-forbidden-strings.sh   ← CI: infrastructure vocabulary lint
```

The first administrator is created by a **local CLI script on the server**, never by a public "first-run setup" web page — that page would be a race for anyone who found the host before you did.

---

## 16. MVP Development Roadmap

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **1** | This document | Approved by you |
| **2** | DB + backend foundation: Prisma schema, migrations, config, crypto, admin bootstrap CLI, admin auth + TOTP, client accounts, device enrollment + signature verification, session rotation, audit skeleton, global exception filter | A device can enroll and log in; a revoked device is rejected; no error ever leaks internals |
| **3** | Document system (admin-side): storage driver, encrypted upload pipeline, MIME sniffing, categories, tags, metadata CRUD, search, metadata list/detail endpoints for clients | Clients can browse and search metadata; contents are still unreachable by design |
| **4** | **Document Master Password**: set/change (admin), Argon2id + pepper, `/vault/unlock`, grants, rate limiting, `dmp_version` invalidation, streaming download, preview, grant sweeper | `/documents/{id}/content` returns 404 without a grant and streams with one; changing the DMP locks every client instantly |
| **5** | Client app: enrollment, login, home, search, categories, list, details, DMP prompt, preview, download, settings, logout, generic-failure screen | End-to-end flow works on a real device |
| **6** | Security hardening: headers, CSP, HSTS, pinning, timing review, forbidden-string CI lint, dependency audit, self-review against §12 | Every §12 row has a test or a documented reason it cannot have one |
| **7** | Testing: the security suite in §17 | Suite green in CI |

Nothing from §33 (OCR, AI search, sharing, versioning) is built until Phase 7 is complete. The schema leaves room for all of it — `search_vector`, `sha256` for dedup, `document_grants` generalizing to share links — but none of it ships in the MVP.

---

## 17. Testing Strategy

Ordinary unit and integration tests exist, but these are the tests that define the product. Each is a red-team assertion, written to fail if a guard is ever removed.

**Authentication**
- Valid enrollment succeeds; reused code fails; expired code fails.
- Login with wrong password fails with an identical body and comparable timing to a nonexistent account.
- Access token without a device signature → 401.
- Signature over a *different* body → 401. Replayed nonce → 401. Timestamp 5 min old → 401.
- Refresh rotation works; a reused refresh token kills the whole session family.

**Authorization**
- Client token on an admin endpoint → 401. Admin token on a client endpoint → 401.
- Every client route is enumerated in a test that asserts each one carries an explicit scope decorator. **A newly added route with no decorator fails the suite.**

**Document Master Password**
- No client route exists that sets, changes, resets, or reads the DMP — asserted by enumerating the router and matching against a forbidden-pattern list.
- Wrong password → 401 `INVALID_CREDENTIAL`, no grant issued, attempt recorded.
- Correct password → grant issued with the configured TTL and current `dmp_version`.
- Rate limit trips after N attempts and rejects the *correct* password while locked out.
- Grant is not a JWT and does not decode to anything client-readable.
- The DMP never appears in any response body, header, or log — asserted by scanning captured output.

**Document access**
- Authenticated, no grant → 404 (not 403, not 401).
- Expired grant → 401 `GRANT_REQUIRED`.
- Grant from device A used on device B → 404.
- Grant issued under `dmp_version = 3` after a change to 4 → 404.
- Document belonging to another client, valid grant → 404, and an audit entry is written.
- Sequential/guessed ids → 404.
- Response bodies and headers never contain `storage_key`, an absolute path, or a hostname.

**Password change and invalidation**
- Admin changes the DMP → every pre-existing grant across all clients and devices is dead on the next request.
- `dmp_version` mismatch alone blocks access even if the revocation sweep is stubbed out (proving the two mechanisms are independent).

**Device revocation**
- Revoked device → 401 on the next request; sessions and grants gone; audit entry present.

**Error handling and leakage** *(highest-signal suite)*
- Kill the database mid-test → client-facing responses stay `{ error: { code, requestId } }` with no driver name, no host, no port.
- Point the storage root at a nonexistent path → 404, no path in the response.
- Force an unhandled exception → 500 `UNAVAILABLE`, no stack in the body, full stack in the log.
- Snapshot every possible error response and assert none matches `/ECONNREFUSED|ENOENT|\/Users\/|\/var\/|postgres|prisma|nest|fastify|node_modules|:\d{4}\b/`.
- CI greps the Flutter localization files for the banned infrastructure vocabulary and fails the build on a hit.

**Upload**
- `.pdf` extension on an actual ELF/script → rejected by magic-byte detection.
- Filename `../../etc/passwd` → stored under a generated UUID key; nothing written outside the storage root.
- Oversize file → stream aborted at the cap, no partial file retained.

**Rate limiting**
- Login, unlock, and download each enforce their own independent limits.

---

## Open questions for you

1. **Zero-knowledge encryption (§7.3)** — accept the server-held KEK (recoverable, searchable, OCR-capable), or go DMP-derived (unrecoverable, no server-side search)? This is the one decision that is expensive to reverse.
2. **Backend language** — NestJS/TypeScript as recommended, or FastAPI/Python if you would rather work in Python?
3. **Client platforms for the MVP** — iOS + Android only, or desktop too?
4. **Admin interface exposure** — LAN/VPN only (recommended), or must it be reachable from the public internet?
5. **Grant TTL default** — 5 minutes as recommended, or do you want 1 minute?

---

Awaiting approval before Phase 2.
