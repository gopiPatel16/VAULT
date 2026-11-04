import { useCallback, useState } from 'react';
import { ApiError, api, setToken } from './api';
import { DashboardView } from './views/DashboardView';
import { DocumentsView } from './views/DocumentsView';
import { ClientsView } from './views/ClientsView';
import { SecurityView } from './views/SecurityView';
import { StepUpDialog } from './views/StepUpDialog';

type Tab = 'dashboard' | 'documents' | 'clients' | 'security';

/**
 * The administrator console.
 *
 * Separate application, separate origin, separate credential — it shares no
 * code with the client and is expected to be served only on a private network.
 * Its token lives in memory, so closing the tab ends the session.
 */
export function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [tab, setTab] = useState<Tab>('dashboard');

  /**
   * Step-up is modelled as a promise the whole app can await.
   *
   * Any action can hit a 412 and pause on `requireStepUp()`, which resolves
   * when both factors have been re-entered — so the destructive operations
   * never need their own bespoke re-auth flow.
   */
  const [stepUpResolve, setStepUpResolve] = useState<((ok: boolean) => void) | null>(null);

  const requireStepUp = useCallback(
    () => new Promise<boolean>((resolve) => setStepUpResolve(() => resolve)),
    [],
  );

  /**
   * Runs an action, and if the backend demands re-authentication, prompts for
   * it and runs the action once more. One retry only — a loop here would sit
   * on the administrator's credentials indefinitely.
   */
  const withStepUp = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof ApiError && error.needsStepUp) {
          if (await requireStepUp()) return action();
        }
        throw error;
      }
    },
    [requireStepUp],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/admin/auth/logout');
    } catch {
      // Ending the local session matters more than the round trip.
    }
    setToken(null);
    setSignedIn(false);
  }, []);

  if (!signedIn) {
    return <LoginView onSignedIn={() => setSignedIn(true)} />;
  }

  return (
    <div className="shell">
      <nav className="side">
        <h1>Vault Administration</h1>
        {(['dashboard', 'documents', 'clients', 'security'] as Tab[]).map((t) => (
          <button
            key={t}
            className={t === tab ? 'active' : ''}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <div className="spacer" />
        <button onClick={signOut}>Sign out</button>
      </nav>

      <main>
        {tab === 'dashboard' && <DashboardView />}
        {tab === 'documents' && <DocumentsView withStepUp={withStepUp} />}
        {tab === 'clients' && <ClientsView withStepUp={withStepUp} />}
        {tab === 'security' && <SecurityView withStepUp={withStepUp} />}
      </main>

      {stepUpResolve && (
        <StepUpDialog
          onDone={(ok) => {
            stepUpResolve(ok);
            setStepUpResolve(null);
          }}
        />
      )}
    </div>
  );
}

function LoginView({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ token: string }>('/admin/auth/login', {
        username,
        password,
        totp,
      });
      setToken(result.token);
      // Cleared immediately; neither value is needed again.
      setPassword('');
      setTotp('');
      onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message_ : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h3>Administrator sign in</h3>
        <p className="sub" style={{ marginBottom: 18 }}>
          Both factors are required.
        </p>

        <div className="field">
          <label htmlFor="u">Username</label>
          <input
            id="u"
            value={username}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="p">Password</label>
          <input
            id="p"
            type="password"
            value={password}
            autoComplete="off"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="t">Authenticator code</label>
          <input
            id="t"
            value={totp}
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            onChange={(e) => setTotp(e.target.value)}
          />
        </div>

        <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Checking...' : 'Sign in'}
        </button>
        {error && <p className="err">{error}</p>}
      </form>
    </div>
  );
}
