import { useState } from 'react';
import { ApiError, api } from '../api';

/**
 * Re-presents both factors before a destructive operation.
 *
 * Required regardless of how recently the administrator signed in, so an
 * unattended open console is not a path to changing the Document Master
 * Password or revoking a client.
 */
export function StepUpDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/auth/stepup', { password, totp });
      setPassword('');
      setTotp('');
      onDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message_ : 'Unable to re-authenticate.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg">
      <form className="modal" onSubmit={submit}>
        <h3>Confirm it is you</h3>
        <p className="sub">
          This action needs your password and authenticator code again.
        </p>

        <div className="field">
          <label htmlFor="sp">Password</label>
          <input
            id="sp"
            type="password"
            autoFocus
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="st">Authenticator code</label>
          <input
            id="st"
            value={totp}
            maxLength={6}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setTotp(e.target.value)}
          />
        </div>

        {error && <p className="err">{error}</p>}

        <div className="actions">
          <button type="button" className="btn" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Checking...' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}
