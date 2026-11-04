import { useCallback, useEffect, useState } from 'react';
import { VaultError, session, vault, type CategorySummary, type DocumentMeta } from './api';

type Stage = 'loading' | 'enrol' | 'signIn' | 'browse';

export function App() {
  const [stage, setStage] = useState<Stage>('loading');
  const [open, setOpen] = useState<DocumentMeta | null>(null);

  useEffect(() => {
    void (async () => {
      // The device stays enrolled across visits; the session never does.
      // A fresh page load therefore always lands on sign-in, which is the
      // point — see the note in api.ts.
      if (!session.isEnrolled) return setStage('enrol');
      setStage(session.isSignedIn && (await vault.resume()) ? 'browse' : 'signIn');
    })();
  }, []);

  // Hiding the tab drops the unlock window at once. Coming back after a long
  // absence drops the whole session, so a tab left open in a pocket does not
  // stay signed in.
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        session.onHidden();
        return;
      }
      if (!session.onVisible()) {
        setOpen(null);
        setStage('signIn');
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  if (stage === 'loading') return <div className="muted">…</div>;
  if (stage === 'enrol') return <Enrol onDone={() => setStage('signIn')} />;
  if (stage === 'signIn') {
    return (
      <SignIn
        onDone={() => setStage('browse')}
        onDeviceRejected={async () => {
          await session.forgetEverything();
          setStage('enrol');
        }}
      />
    );
  }

  return open ? (
    <Detail document={open} onBack={() => setOpen(null)} />
  ) : (
    <Browse
      onOpen={setOpen}
      onSignOut={async () => {
        await vault.signOut();
        setStage('signIn');
      }}
    />
  );
}

/* ── Enrolment ──────────────────────────────────────────────────────────── */

function Enrol({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('My device');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await vault.enroll(code.trim().toUpperCase(), name.trim() || 'My device');
      onDone();
    } catch (err) {
      setError(
        err instanceof VaultError && err.failure === 'invalidCredential'
          ? 'That setup code was not accepted.'
          : err instanceof VaultError
            ? err.text
            : 'Unable to load this page.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centre">
      <form className="card" onSubmit={submit}>
        <div className="lock-emoji">🔒</div>
        <h2>Private Vault</h2>
        <p className="lead">Enter the setup code you were given to authorise this device.</p>

        <div className="field">
          <label htmlFor="code">Setup code</label>
          <input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label htmlFor="name">Device name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <button className="btn" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Authorise device'}
        </button>
        {error && <p className="err">{error}</p>}
      </form>
    </div>
  );
}

/* ── Sign in ────────────────────────────────────────────────────────────── */
/* No "forgot password" anywhere: only the administrator can help.           */

function SignIn({
  onDone,
  onDeviceRejected,
}: {
  onDone: () => void;
  onDeviceRejected: () => void;
}) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await vault.signIn(loginId.trim(), password);
      setPassword('');
      onDone();
    } catch (err) {
      if (err instanceof VaultError && err.failure === 'notAuthorised') {
        return onDeviceRejected();
      }
      setError(err instanceof VaultError ? err.text : 'Unable to load this page.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="centre">
      <form className="card" onSubmit={submit}>
        <div className="lock-emoji">📁</div>
        <h2>Private Vault</h2>
        <p className="lead">Sign in to browse your documents.</p>

        <div className="field">
          <label htmlFor="acct">Account</label>
          <input
            id="acct"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button className="btn" disabled={busy || !loginId.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="err">{error}</p>}
      </form>
    </div>
  );
}

/* ── Browse ─────────────────────────────────────────────────────────────── */

function Browse({
  onOpen,
  onSignOut,
}: {
  onOpen: (d: DocumentMeta) => void;
  onSignOut: () => void;
}) {
  const [documents, setDocuments] = useState<DocumentMeta[] | null>(null);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [favourites, setFavourites] = useState(false);
  const [error, setError] = useState<VaultError | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await vault.documents({
        q: search || undefined,
        category: category ?? undefined,
        favourites,
      });
      setDocuments(page.items);
    } catch (err) {
      setError(err instanceof VaultError ? err : new VaultError('unavailable'));
    }
  }, [search, category, favourites]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    vault.categories().then(setCategories).catch(() => undefined);
  }, []);

  return (
    <div className="wrap">
      <header className="bar">
        <h1>Private Vault</h1>
        {session.isUnlocked && (
          <button title="Lock" onClick={() => void vault.lock().then(load)}>
            🔓
          </button>
        )}
        <button title="Sign out" onClick={onSignOut}>
          ⏻
        </button>
      </header>

      <div className="search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setSearch(query.trim())}
          placeholder="Search documents…"
        />
        <button className="btn ghost" style={{ width: 'auto' }} onClick={() => setSearch(query.trim())}>
          Search
        </button>
      </div>

      <div className="chips">
        <button
          className={`chip ${favourites ? 'on' : ''}`}
          onClick={() => setFavourites((v) => !v)}
        >
          ★ Favourites
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            className={`chip ${category === c.slug ? 'on' : ''}`}
            onClick={() => setCategory((v) => (v === c.slug ? null : c.slug))}
          >
            {c.name} ({c.documentCount})
          </button>
        ))}
      </div>

      {session.isUnlocked && (
        <div className="banner">
          🔓 Access expires in {Math.ceil(session.unlockSecondsLeft / 60)} minute(s).
        </div>
      )}

      {error ? (
        <Failure error={error} onRetry={load} />
      ) : documents === null ? (
        <p className="muted">Loading…</p>
      ) : documents.length === 0 ? (
        <p className="muted">No documents.</p>
      ) : (
        documents.map((d) => (
          <button key={d.id} className="doc" onClick={() => onOpen(d)}>
            <span className="type">{shortType(d.fileType)}</span>
            <span>
              <div className="title">{d.title}</div>
              <div className="sub">
                {d.category.name} · {readableSize(d.sizeBytes)}
              </div>
            </span>
            {d.isFavourite && <span className="star">★</span>}
          </button>
        ))
      )}
    </div>
  );
}

/* ── One document ───────────────────────────────────────────────────────── */

function Detail({ document: doc, onBack }: { document: DocumentMeta; onBack: () => void }) {
  const [meta, setMeta] = useState(doc);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(session.isUnlocked);

  // A preview is decrypted content. When the window closes it goes with it.
  useEffect(() => {
    if (!unlocked && preview) {
      URL.revokeObjectURL(preview);
      setPreview(null);
    }
  }, [unlocked, preview]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const need = async (run: () => Promise<void>) => {
    if (!session.isUnlocked) return setAsking(true);
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (err) {
      setError(err instanceof VaultError ? err.text : 'Unable to load this page.');
      if (err instanceof VaultError && err.failure === 'locked') setUnlocked(false);
    } finally {
      setBusy(false);
    }
  };

  const doPreview = () =>
    need(async () => {
      const bytes = await vault.content(meta.id, true);
      setPreview(URL.createObjectURL(new Blob([bytes], { type: meta.fileType })));
    });

  const doDownload = () =>
    need(async () => {
      const bytes = await vault.content(meta.id);
      const url = URL.createObjectURL(new Blob([bytes], { type: meta.fileType }));
      const a = window.document.createElement('a');
      a.href = url;
      a.download = meta.filename;
      a.click();
      URL.revokeObjectURL(url);
    });

  const toggleStar = async () => {
    const next = !meta.isFavourite;
    setMeta({ ...meta, isFavourite: next });
    try {
      await vault.setFavourite(meta.id, next);
    } catch {
      setMeta({ ...meta, isFavourite: !next });
    }
  };

  return (
    <div className="wrap">
      <header className="bar">
        <button onClick={onBack}>←</button>
        <h1>{meta.title}</h1>
        <button title="Favourite" onClick={() => void toggleStar()}>
          {meta.isFavourite ? '★' : '☆'}
        </button>
      </header>

      <div className="card wide">
        <dl style={{ margin: 0 }}>
          <div className="meta"><dt>File</dt><dd>{meta.filename}</dd></div>
          <div className="meta"><dt>Type</dt><dd>{shortType(meta.fileType)}</dd></div>
          <div className="meta"><dt>Size</dt><dd>{readableSize(meta.sizeBytes)}</dd></div>
          <div className="meta"><dt>Category</dt><dd>{meta.category.name}</dd></div>
          {meta.tags.length > 0 && (
            <div className="meta"><dt>Tags</dt><dd>{meta.tags.join(', ')}</dd></div>
          )}
          <div className="meta"><dt>Added</dt><dd>{meta.uploadedAt.slice(0, 10)}</dd></div>
        </dl>
      </div>

      {!unlocked ? (
        <div className="card wide" style={{ textAlign: 'center' }}>
          <div className="lock-emoji">🔐</div>
          <strong>Protected Document</strong>
          <p className="lead" style={{ marginTop: 6 }}>
            The document master password is required to view or download this file.
          </p>
          <button className="btn" onClick={() => setAsking(true)}>
            Unlock Document
          </button>
        </div>
      ) : (
        <>
          <div className="row2">
            <button className="btn ghost" disabled={busy} onClick={doPreview}>
              Preview
            </button>
            <button className="btn" disabled={busy} onClick={doDownload}>
              Download
            </button>
          </div>
          <p className="lead" style={{ marginTop: 10 }}>
            Access expires in {Math.ceil(session.unlockSecondsLeft / 60)} minute(s).
          </p>
        </>
      )}

      {busy && <p className="muted">Working…</p>}
      {error && <p className="err">{error}</p>}

      {preview && (
        <div className="preview">
          {meta.fileType.startsWith('image/') ? (
            <img src={preview} alt="" />
          ) : (
            <iframe src={preview} title="preview" />
          )}
        </div>
      )}

      {asking && (
        <UnlockSheet
          onClose={() => setAsking(false)}
          onUnlocked={() => {
            setAsking(false);
            setUnlocked(true);
          }}
        />
      )}
    </div>
  );
}

/* ── The master password prompt ─────────────────────────────────────────── */
/* Collects it, submits it, keeps nothing. No reset, no recovery, no change. */

function UnlockSheet({ onClose, onUnlocked }: { onClose: () => void; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await vault.unlock(password);
      setPassword('');
      onUnlocked();
    } catch (err) {
      setError(
        err instanceof VaultError && err.failure === 'invalidCredential'
          ? 'Invalid password.'
          : err instanceof VaultError
            ? err.text
            : 'Unable to load this page.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <form className="sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>🔐 Protected Document</h3>
        <p className="lead" style={{ textAlign: 'left', marginBottom: 16 }}>
          Enter the document master password.
        </p>
        <div className="field">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="•••••••••••••"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {error && <p className="err">{error}</p>}
        <button className="btn" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Unlock Document'}
        </button>
      </form>
    </div>
  );
}

/* ── The one failure screen ─────────────────────────────────────────────── */

function Failure({ error, onRetry }: { error: VaultError; onRetry: () => void }) {
  return (
    <div className="fail">
      <div className="code">404</div>
      <p>{error.text}</p>
      <button className="btn ghost" style={{ width: 'auto' }} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

function shortType(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/png': 'PNG',
    'image/jpeg': 'JPG',
    'image/webp': 'WEBP',
    'image/heic': 'HEIC',
    'text/plain': 'TXT',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  };
  return map[mime] ?? 'FILE';
}

function readableSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
