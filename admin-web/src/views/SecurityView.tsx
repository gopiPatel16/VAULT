import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type AuditEntry, type MasterPasswordStatus, type Page } from '../api';

interface Props {
  withStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

/**
 * The Document Master Password lives here and nowhere else.
 *
 * This is the only surface in the entire system that can set or change it. The
 * client application has no counterpart to any of this — not a disabled
 * screen, not a permission-gated one: the routes do not exist over there.
 */
export function SecurityView({ withStepUp }: Props) {
  const [status, setStatus] = useState<MasterPasswordStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.get<MasterPasswordStatus>('/admin/security/master-password'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message_ : 'Unable to load.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<string>) => {
    setError(null);
    setNotice(null);
    try {
      setNotice(await withStepUp(action));
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message_ : 'Unable to complete that.');
    }
  };

  if (!status) return <p className="sub">{error ?? 'Loading...'}</p>;

  return (
    <>
      <h2>Security</h2>
      <p className="sub">
        The Document Master Password protects document contents. Clients can
        submit it; only you can change it.
      </p>

      {!status.configured && (
        <div className="warn">
          <strong>Not configured.</strong> No document contents are readable
          until a master password is set.
        </div>
      )}

      {status.configured ? (
        <ChangeMasterPassword onRun={run} version={status.version} />
      ) : (
        <SetMasterPassword onRun={run} />
      )}

      <GrantTtl
        current={status.grantTtlSeconds}
        allowed={status.allowedGrantTtls}
        onRun={run}
      />

      <div className="card">
        <h3>Document sessions</h3>
        <p className="sub" style={{ marginBottom: 12 }}>
          {status.activeDocumentSessions} client
          {status.activeDocumentSessions === 1 ? '' : 's'} currently hold an
          unlock window. Invalidating forces every one of them to enter the
          master password again on their next request.
        </p>
        <button
          className="btn danger"
          onClick={() =>
            void run(async () => {
              const result = await api.post<{ invalidatedDocumentSessions: number }>(
                '/admin/security/invalidate-all-grants',
              );
              return `Invalidated ${result.invalidatedDocumentSessions} document session(s).`;
            })
          }
        >
          Invalidate all document sessions
        </button>
      </div>

      {error && <p className="err">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <AuditLog />
    </>
  );
}

function SetMasterPassword({ onRun }: { onRun: (a: () => Promise<string>) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  return (
    <div className="card">
      <h3>Set the Document Master Password</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="mp1">New master password</label>
          <input
            id="mp1"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="mp2">Confirm</label>
          <input
            id="mp2"
            type="password"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>
      {local && <p className="err">{local}</p>}
      <button
        className="btn primary"
        onClick={() => {
          // Checked here purely to save a round trip; the backend enforces its
          // own policy and is the authority.
          if (password !== confirm) return setLocal('Those do not match.');
          if (password.length < 8) return setLocal('At least 8 characters.');
          setLocal(null);
          onRun(async () => {
            await api.post('/admin/security/master-password', { password });
            setPassword('');
            setConfirm('');
            return 'Master password set.';
          });
        }}
      >
        Set master password
      </button>
    </div>
  );
}

function ChangeMasterPassword({
  onRun,
  version,
}: {
  onRun: (a: () => Promise<string>) => void;
  version: number;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  return (
    <div className="card">
      <h3>Change the Document Master Password</h3>
      <p className="sub" style={{ marginBottom: 14 }}>
        Currently version {version}. Changing it immediately locks every client
        out of document contents — they will each need the new password.
      </p>

      <div className="field">
        <label htmlFor="cur">Current master password</label>
        <input
          id="cur"
          type="password"
          autoComplete="off"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="nw">New master password</label>
          <input
            id="nw"
            type="password"
            autoComplete="off"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="cf">Confirm new</label>
          <input
            id="cf"
            type="password"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
      </div>

      {local && <p className="err">{local}</p>}
      <button
        className="btn primary"
        onClick={() => {
          if (next !== confirm) return setLocal('The new values do not match.');
          if (next.length < 8) return setLocal('At least 8 characters.');
          setLocal(null);
          onRun(async () => {
            const result = await api.put<{
              version: number;
              invalidatedDocumentSessions: number;
            }>('/admin/security/master-password', {
              currentPassword: current,
              newPassword: next,
              confirmNewPassword: confirm,
            });
            setCurrent('');
            setNext('');
            setConfirm('');
            return `Changed to version ${result.version}; ${result.invalidatedDocumentSessions} document session(s) invalidated.`;
          });
        }}
      >
        Change master password
      </button>
    </div>
  );
}

function GrantTtl({
  current,
  allowed,
  onRun,
}: {
  current: number;
  allowed: number[];
  onRun: (a: () => Promise<string>) => void;
}) {
  const [seconds, setSeconds] = useState(current);

  return (
    <div className="card">
      <h3>Document access timeout</h3>
      <p className="sub" style={{ marginBottom: 12 }}>
        How long an unlock lasts before the master password is needed again.
        There is no sliding renewal: activity does not extend the window.
      </p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="ttl">Timeout</label>
          <select
            id="ttl"
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          >
            {allowed.map((s) => (
              <option key={s} value={s}>
                {s / 60} minute{s === 60 ? '' : 's'}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn"
          style={{ flex: 0 }}
          onClick={() =>
            onRun(async () => {
              await api.put('/admin/security/grant-ttl', { seconds });
              return `Timeout set to ${seconds / 60} minute(s).`;
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Page<AuditEntry>>('/admin/security/audit-log?limit=25')
      .then((page) => setEntries(page.items))
      .catch(() => setEntries([]));
  }, []);

  return (
    <div className="card">
      <h3>Audit log</h3>
      <p className="sub" style={{ marginBottom: 12 }}>
        Append-only and hash-chained: removing or editing a historical entry
        breaks the chain from that point on.
      </p>

      <button
        className="btn"
        onClick={() =>
          void api
            .get<{ ok: boolean; brokenAtId?: string; checked: number }>(
              '/admin/security/audit-log/verify',
            )
            .then((r) =>
              setChain(
                r.ok
                  ? `Chain intact across ${r.checked} entries.`
                  : `Chain broken at entry ${r.brokenAtId}.`,
              ),
            )
            .catch(() => setChain('Unable to verify.'))
        }
      >
        Verify chain integrity
      </button>
      {chain && <p className={chain.includes('intact') ? 'ok' : 'err'}>{chain}</p>}

      <table style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>When</th>
            <th>Event</th>
            <th>Actor</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="mono">{new Date(e.at).toLocaleString()}</td>
              <td className="mono">{e.event}</td>
              <td>{e.actorType}</td>
              <td>
                <span className={`pill ${e.result === 'success' ? 'good' : 'bad'}`}>
                  {e.result}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
