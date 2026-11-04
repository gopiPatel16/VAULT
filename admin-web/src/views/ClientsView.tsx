import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Category, type ClientSummary, type DeviceSummary } from '../api';

interface Props {
  withStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

/**
 * Client and device management.
 *
 * Access is deny by default: a newly created client can see nothing at all
 * until categories are granted to it here.
 */
export function ClientsView({ withStepUp }: Props) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<ClientSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setClients(await api.get<ClientSummary[]>('/admin/clients'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message_ : 'Unable to load.');
    }
  }, []);

  useEffect(() => {
    void load();
    api.get<Category[]>('/admin/categories').then(setCategories).catch(() => undefined);
  }, [load]);

  return (
    <>
      <h2>Clients</h2>
      <p className="sub">People and the devices they have authorised.</p>

      <CreateClient
        onCreated={(name) => {
          setNotice(`Created ${name}. Grant it categories, then issue a setup code.`);
          setError(null);
          void load();
        }}
        onError={setError}
      />

      <div className="card">
        <h3>Existing clients</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Account</th>
              <th>Status</th>
              <th>Devices</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>{c.displayName}</td>
                <td className="mono">{c.loginId}</td>
                <td>
                  <span className={`pill ${c.status === 'active' ? 'good' : 'bad'}`}>
                    {c.status}
                  </span>
                </td>
                <td>
                  {c.deviceCount} / {c.maxDevices}
                </td>
                <td className="mono">
                  {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleString() : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn" onClick={() => setSelected(c)}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6} className="sub" style={{ padding: '16px 10px' }}>
                  No clients yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <ManageClient
          client={selected}
          categories={categories}
          withStepUp={withStepUp}
          onClose={() => {
            setSelected(null);
            void load();
          }}
          onCode={(c, m) => setCode({ code: c, minutes: m })}
          onNotice={setNotice}
          onError={setError}
        />
      )}

      {code && (
        <div className="modal-bg">
          <div className="modal">
            <h3>Device setup code</h3>
            <p className="sub">
              Single use, expires in {code.minutes} minutes. Give it to the
              person directly — it is not shown again. On its own it is not a
              way in: the account password is still required.
            </p>
            <div className="code">{code.code}</div>
            <div className="actions">
              <button className="btn primary" onClick={() => setCode(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="err">{error}</p>}
      {notice && <p className="ok">{notice}</p>}
    </>
  );
}

function CreateClient({
  onCreated,
  onError,
}: {
  onCreated: (name: string) => void;
  onError: (m: string) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="card">
      <h3>Add a client</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="dn">Display name</label>
          <input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="li">Account id</label>
          <input
            id="li"
            value={loginId}
            autoComplete="off"
            onChange={(e) => setLoginId(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pw">Password (8+ characters)</label>
          <input
            id="pw"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      </div>
      <button
        className="btn primary"
        disabled={busy}
        onClick={() => {
          void (async () => {
            setBusy(true);
            try {
              await api.post('/admin/clients', { displayName, loginId, password });
              const name = displayName;
              setDisplayName('');
              setLoginId('');
              setPassword('');
              onCreated(name);
            } catch (e) {
              onError(e instanceof ApiError ? e.message_ : 'Unable to create.');
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        Create client
      </button>
    </div>
  );
}

function ManageClient({
  client,
  categories,
  withStepUp,
  onClose,
  onCode,
  onNotice,
  onError,
}: {
  client: ClientSummary;
  categories: Category[];
  withStepUp: <T>(action: () => Promise<T>) => Promise<T>;
  onClose: () => void;
  onCode: (code: string, minutes: number) => void;
  onNotice: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [granted, setGranted] = useState<string[]>([]);

  const reload = useCallback(async () => {
    const [d, a] = await Promise.all([
      api.get<DeviceSummary[]>(`/admin/clients/${client.id}/devices`),
      api.get<{ categorySlugs: string[] }>(`/admin/clients/${client.id}/access`),
    ]);
    setDevices(d);
    setGranted(a.categorySlugs);
  }, [client.id]);

  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  return (
    <div className="modal-bg">
      <div className="modal" style={{ width: 560 }}>
        <h3>{client.displayName}</h3>
        <p className="sub">{client.loginId}</p>

        <div className="card" style={{ marginTop: 14 }}>
          <h3>Categories this client may see</h3>
          <p className="sub" style={{ marginBottom: 10 }}>
            Nothing is visible until something is granted.
          </p>
          {categories.map((c) => (
            <label key={c.slug} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={granted.includes(c.slug)}
                onChange={(e) =>
                  setGranted((prev) =>
                    e.target.checked
                      ? [...prev, c.slug]
                      : prev.filter((s) => s !== c.slug),
                  )
                }
              />
              <span>{c.name}</span>
            </label>
          ))}
          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => {
              void api
                .put(`/admin/clients/${client.id}/access`, { categorySlugs: granted })
                .then(() => onNotice('Access updated.'))
                .catch((e: unknown) =>
                  onError(e instanceof ApiError ? e.message_ : 'Unable to update.'),
                );
            }}
          >
            Save access
          </button>
        </div>

        <div className="card">
          <h3>Devices</h3>
          <table>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="mono">{d.platform}</td>
                  <td>
                    <span className={`pill ${d.status === 'active' ? 'good' : 'bad'}`}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {d.status === 'active' && (
                      <button
                        className="btn danger"
                        onClick={() => {
                          void api
                            .post(`/admin/devices/${d.id}/revoke`)
                            .then(() => {
                              onNotice(`Revoked ${d.name}.`);
                              return reload();
                            })
                            .catch((e: unknown) =>
                              onError(
                                e instanceof ApiError ? e.message_ : 'Unable to revoke.',
                              ),
                            );
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr>
                  <td className="sub">No devices enrolled.</td>
                </tr>
              )}
            </tbody>
          </table>

          <button
            className="btn"
            style={{ marginTop: 10 }}
            onClick={() => {
              void api
                .post<{ code: string; expiresInMinutes: number }>(
                  `/admin/clients/${client.id}/enrollment-code`,
                )
                .then((r) => onCode(r.code, r.expiresInMinutes))
                .catch((e: unknown) =>
                  onError(e instanceof ApiError ? e.message_ : 'Unable to issue a code.'),
                );
            }}
          >
            Issue device setup code
          </button>
        </div>

        <div className="actions">
          <button
            className="btn danger"
            onClick={() => {
              void (async () => {
                try {
                  await withStepUp(() => api.post(`/admin/clients/${client.id}/revoke`));
                  onNotice(`Revoked ${client.displayName} and all their devices.`);
                  onClose();
                } catch (e) {
                  onError(e instanceof ApiError ? e.message_ : 'Unable to revoke.');
                }
              })();
            }}
          >
            Revoke this client
          </button>
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
