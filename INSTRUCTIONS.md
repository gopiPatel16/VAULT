# Vault — moving the server to this Windows machine

**Read this file completely before running anything.**

You are being handed a working, security-critical system. It is not a project to
scaffold or redesign — it already runs correctly on the machine it came from.
Your job is to bring it up here **unchanged**, and to verify it behaves the same.

The owner is not a developer. Explain what you are doing in plain language, and
do not leave them at a half-finished step.

---

## 1. Rules that must not be broken

These come from the original specification. They are not stylistic preferences;
several of them protect data that cannot be recovered if lost.

**Never regenerate the secrets in `backend/.env`.**
`STORAGE_KEK` unwraps the encryption key of every stored document. `SERVER_PEPPER`
is mixed into every password hash. If you replace either — or "helpfully" generate
a fresh `.env` because one looks missing — **every existing document becomes
permanently unreadable and every password stops working.** There is no recovery.
If `.env` is absent, stop and tell the owner; do not invent one.

**The client side must never learn anything about infrastructure.**
No server status, IP, hostname, location, OS, filesystem, storage path, database
detail, or hosting information may ever reach a client response. Do not introduce
phrases like "server offline", "home server", "connection failed", or
"backend unavailable" into any client-facing text. The established pattern for
anything unreachable or unauthorised is a plain `404 / Page Not Found`.

**The Document Master Password is administrator-only.**
Clients may *submit* it for verification and nothing else. There must be no
client-side route, screen, button, or API for changing, resetting, recovering, or
viewing it — not even a disabled one. Its absence is the guarantee. Do not add a
"forgot password" flow anywhere.

**Keep the administrator console off the tunnel.**
The admin console (port 5173) is bound to this machine only. The public tunnel
carries the client website (port 8080) alone, and the front door in
`edge/server.mjs` deliberately returns 404 for `/api/v1/admin*`. Do not "fix"
that; it is intentional.

**Never commit `backend/.env`.** It is already in `.gitignore`. Keep it there.

---

## 2. What is in this folder

| Path | What it is |
|---|---|
| `backend/` | The API. NestJS + Fastify + Prisma. |
| `web-client/` | The client website people log into. |
| `admin-web/` | The administrator console. This machine only. |
| `edge/server.mjs` | Single front door on port 8080: serves the site, proxies the API, hides admin routes. |
| `scripts/vault-up.sh` | Starts everything. |
| `migration/vault-db.sql` | **The database.** Restore this — see step 4. |
| `migration/expected-counts.txt` | What the vault contained at export time. Verify against it. |
| `backend/var/storage/` | The encrypted document files. Must arrive intact. |
| `backend/.env` | The secrets. Irreplaceable — see rule 1. |

**`node_modules` is deliberately not included.** The original machine is an ARM
Mac and its compiled binaries (`argon2`, Prisma's query engine) do not run here.
You will reinstall them in step 5. If a `node_modules` folder did come across,
delete it before installing.

---

## 3. Prerequisites

**Strongly prefer WSL2 with Ubuntu.** The start script is bash and uses `lsof`;
under WSL2 everything runs exactly as it does on the source machine and you will
change almost nothing. Native Windows means porting the script to PowerShell and
gambling on whether `argon2` has a prebuilt binary for Node 24 — avoid it unless
the owner specifically wants native Windows.

Inside WSL2 (Ubuntu), install:

- **Node.js 24.x** — the source machine runs v24.18.0
- **PostgreSQL 16** — the dump was taken from 16.14
- **cloudflared** — for the public address

**Put the project in the Linux filesystem: `~/vault`. Do not use `/mnt/c/...`.**
Crossing the Windows/Linux filesystem boundary makes builds crawl, breaks file
watching, and produces odd permission behaviour.

---

## 4. Restore the database — do this before anything else

The database does **not** live inside the project folder; it was exported to
`migration/vault-db.sql`. Without this step Vault starts up completely empty and
the encrypted files are orphaned blobs.

```bash
sudo service postgresql start
createdb vault_dev
psql -d vault_dev -f migration/vault-db.sql
```

Then **change `DATABASE_URL` in `backend/.env`.** It currently names a macOS
account that does not exist here:

```
DATABASE_URL=postgresql://gopipatel@localhost:5432/vault_dev
```

Change only the username to your PostgreSQL role, keeping the database name
`vault_dev`. Update `TEST_DATABASE_URL` the same way (database `vault_test`).
**Change nothing else in that file** — in particular not `STORAGE_KEK`,
`SERVER_PEPPER`, `JWT_SECRET`, or `IP_HASH_SALT`.

Verify the restore matches what was exported:

```bash
psql -d vault_dev -tAc "select 'documents='||(select count(*) from documents)||' clients='||(select count(*) from clients)||' devices='||(select count(*) from devices)||' audit='||(select count(*) from audit_log)"
cat migration/expected-counts.txt
```

Those two lines must match. If they do not, stop and tell the owner rather than
proceeding.

Confirm the master password came across:

```bash
psql -d vault_dev -tAc "select case when dmp_hash is not null then 'configured, version '||dmp_version else 'NOT CONFIGURED' end from vault_secret where id=1"
```

It should say **configured**. If it says `NOT CONFIGURED`, the wrong dump was
restored — do not set a new one, ask the owner.

---

## 5. Install and build

```bash
cd ~/vault/backend && npm install
npx prisma generate
```

**Do not run `prisma migrate dev`.** The restored dump already contains the full
schema and migration history. `prisma generate` only rebuilds the client library
for this platform, which is what is needed.

```bash
cd ~/vault/web-client && npm install
cd ~/vault/admin-web  && npm install
```

---

## 6. Verify before going live

Run the test suite. It should pass in full — 117 tests across 10 suites:

```bash
cd ~/vault/backend && npm test
```

Run the leakage check, which fails if any forbidden infrastructure wording or a
client-side password-reset path has crept in:

```bash
npm run lint:leakage
```

If either fails, fix the cause — do not skip past it. These tests are the
evidence that the security properties still hold on the new machine.

---

## 7. Start it

```bash
cd ~/vault
./scripts/vault-up.sh            # this machine only
./scripts/vault-up.sh --public   # plus a public address, reachable anywhere
```

The script starts PostgreSQL if needed, builds, launches the API, the website
front door, and the admin console, and prints the addresses. `Ctrl-C` stops
everything and sweeps the ports.

- Website (clients): `http://localhost:8080`
- Admin console: `http://localhost:5173` — this machine only, never tunnelled
- With `--public`: a `https://….trycloudflare.com` address usable from anywhere

**The public address changes every restart.** If the owner wants a permanent one,
set up a *named* Cloudflare tunnel — worth doing on a machine meant to be the
permanent server.

For the vault to be reachable at any time, this machine must stay powered on and
not sleep. Check Windows sleep settings.

---

## 8. Confirm it actually works

Do not report success until you have seen this whole sequence:

1. Open the website; sign in as an existing client
2. Document titles list — this is metadata only, and correct at this stage
3. Open a document **without** entering the master password → refused
4. Enter a wrong master password → rejected
5. Enter the correct one → the document decrypts and displays
6. From outside, `/api/v1/admin/security/master-password` returns **404**
7. Close the browser entirely, reopen → it asks for ID and password again

Step 7 matters: the session is deliberately memory-only so that closing the
browser ends it. If reopening restores the session without credentials, that is a
security regression — report it.

---

## 9. Troubleshooting

**"Port already in use" but nothing responds.** A previous run left an orphan.
The start script sweeps ports automatically, but if one persists, find and clear
it: `lsof -nP -tiTCP:5173 -sTCP:LISTEN`. If the holder shows state `T` it is
suspended and ignoring signals — send `kill -CONT` first, then `kill`.

**`localhost` slow or refusing.** Servers must listen on both IPv4 and IPv6
loopback; `localhost` resolves to `::1` first on many systems. `edge/server.mjs`
already runs two listeners for this reason. Do not reduce it to one.

**`argon2` fails to build.** It needs build tools: `sudo apt install build-essential python3`.
Under native Windows it may need Visual Studio Build Tools — another reason to use WSL2.

**Documents list but will not open.** Usually a `STORAGE_KEK` mismatch or a
missing `backend/var/storage/`. Do not regenerate anything; check both came
across intact.

---

## 10. Do not do these

- Do not regenerate or "fix" the secrets in `.env`
- Do not run `prisma migrate reset` — it destroys the database
- Do not add any client-facing master-password reset, recovery, or change flow
- Do not expose the admin console through the tunnel
- Do not put infrastructure details into any client-facing message
- Do not run this vault on two machines at once — they diverge immediately into
  two different vaults with incompatible audit chains and device records
