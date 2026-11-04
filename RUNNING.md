# Running Vault

Vault is a **website**. You run it on your Mac; you and the people you trust
open it in a browser — from home, from work, from mobile data, anywhere.

All commands run from the project folder:

```bash
cd ~/Desktop/VaulT
```

---

## The three pieces

| | What it is | Who opens it |
|---|---|---|
| **API** (`backend/`) | The brain. Holds documents, checks passwords. | Nobody directly |
| **Website** (`web-client/`) | What your family opens. Browse and download documents. | Anyone you authorise |
| **Admin console** (`admin-web/`) | Upload documents, add people, set the master password. | **Only you, only on this Mac** |

The website and the API are served on **one address** so they always agree.
The admin console is deliberately **not** on that address — it never leaves
your machine, so putting the website on the internet does not put the
administrator surface there with it.

---

## 0. One-time setup

```bash
brew install node postgresql@16 cloudflared
brew services start postgresql@16

cd backend    && npm install && cd ..
cd web-client && npm install && cd ..
cd admin-web  && npm install && cd ..
```

Configuration:

```bash
cd backend
cp .env.example .env
npm run gen:keys        # paste the four secrets into .env
```

Set `DATABASE_URL` in `.env` to your Mac username:

```
DATABASE_URL=postgresql://YOUR_USERNAME@localhost:5432/vault_dev
```

> **Back up `STORAGE_KEK` somewhere other than this machine.** It is the key
> that decrypts every document. Lose it and they are gone permanently.

Create your administrator account:

```bash
cd backend && npm run bootstrap:admin
```

It prints your **two-factor secret** and **recovery codes exactly once** — add
the secret to an authenticator app before closing the terminal.

---

## 1. Start it

**On your machine only:**

```bash
bash scripts/vault-up.sh
```

**Reachable from anywhere:**

```bash
bash scripts/vault-up.sh --public
```

The second prints a public HTTPS address like:

```
https://mixture-tile-guestbook-amendments.trycloudflare.com
```

Open that on any phone, on mobile data, from anywhere in the world. Ctrl-C
stops everything and the address dies with it.

### How that works, briefly

`cloudflared` makes an **outbound** connection from your Mac to Cloudflare, and
Cloudflare forwards visitors back down it. Nothing is opened on your router, you
need no fixed IP address, and your home address never appears in DNS. It is the
same mechanism whether the visitor is in the next room or another country —
there is no "same Wi-Fi" requirement anywhere in this.

---

## 2. First run, in order

1. **Open the admin console** — http://localhost:5173 — sign in with your
   username, password, and authenticator code.

2. **Set the Document Master Password** (Security tab). Until this is set, *no
   document contents are readable by anyone*. You will be asked for both
   factors again; that is required for every destructive action.

3. **Upload documents** (Documents tab). The file type is decided by the actual
   bytes, not the extension.

4. **Add a person** (Clients tab) — display name, account id, password.

5. **Manage → tick their categories → Save.** They see nothing until you do.

6. **Manage → Issue device setup code.** Single use, 15 minutes. Send it to
   them along with the public address and their account password.

---

## 3. What they do

On any phone or computer, they open the address you sent and:

1. Enter the **setup code** → the browser creates a device key for itself
2. Sign in with their **account and password**
3. Browse and search
4. Tap a document → it asks for the **Document Master Password** → Preview and
   Download appear for five minutes, then re-lock

The setup code is needed once per device. After that the browser remembers
that device until they clear site data.

---

## 4. A permanent address (optional)

The free `trycloudflare.com` address changes every restart, which is fine for
family use but means resending the link. For a fixed address you need a domain
name (about ₹800/year) pointed at Cloudflare:

```bash
cloudflared tunnel login
cloudflared tunnel create vault
cloudflared tunnel route dns vault vault.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8080 vault
```

Then the address is always `https://vault.yourdomain.com`.

---

## 5. Tests

```bash
createdb vault_test
cd backend && npm test                 # 113 tests
cd web-client && npm run build
cd admin-web  && npm run build
bash scripts/check-forbidden-strings.sh
```

---

## 6. If something goes wrong

**The website says "Unable to load this page."** — deliberate; it never says
why. Check the terminal running the API instead.

**"PostgreSQL will not start"** — usually a stale lock after an unclean
shutdown. Check nothing is really running, then:

```bash
pgrep -fl postgres            # should show nothing
rm -f /opt/homebrew/var/postgresql@16/postmaster.pid
brew services restart postgresql@16
```

**The public address does not load** — some networks block the tunnel's
default QUIC transport. The script already forces HTTP/2, which works on
almost everything. If it still fails, check the terminal for the cloudflared
output.

**Build fails, or odd binary errors** — if the project is on an exFAT drive,
macOS scatters `._` files that confuse the tools:

```bash
find . -name '._*' -type f -delete
```

Keep the project on the internal disk. See §7.

**Nothing readable even as administrator** — Security tab must show a Document
Master Password is configured. Unconfigured means locked, by design.

---

## 7. Things worth knowing

- **Your Mac must be awake and running the script** for the vault to be
  reachable. Close the laptop and the address stops working. If you want it up
  permanently, it needs to live on something always-on.
- **Keep the project on the internal disk.** An exFAT USB drive silently
  discards file permissions, breaks native modules with `._` sidecar files,
  and — in this project's case — corrupted source files outright.
- **The admin console never goes through the tunnel.** Administer from this
  machine.
- **Back up three things together**; any one alone is useless: the database,
  the `STORAGE_ROOT` blobs, and `STORAGE_KEK`.

## 8. Later: phone apps

The Flutter client in `client-app/` is written and tested and can become real
iPhone/Android apps when you want. iPhone builds need Xcode (~15 GB); Android
needs the SDK command-line tools. The website works on phones in the meantime —
it is mobile-shaped, and on iOS and Android you can "Add to Home Screen" to get
an icon that opens it like an app.
