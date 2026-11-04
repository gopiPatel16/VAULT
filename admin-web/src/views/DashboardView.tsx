import { useEffect, useState } from 'react';
import { ApiError, api, formatBytes, type Dashboard } from '../api';

export function DashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Dashboard>('/admin/dashboard')
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? e.message_ : 'Unable to load.'),
      );
  }, []);

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="sub">Loading...</p>;

  return (
    <>
      <h2>Dashboard</h2>
      <p className="sub">Current state of the vault.</p>

      {!data.masterPassword.configured && (
        <div className="warn">
          <strong>No Document Master Password is set.</strong> Until you set one
          in Security, no document contents can be read by anyone — the vault
          fails closed.
        </div>
      )}

      <div className="grid">
        <Stat n={data.documents} l="Documents" />
        <Stat n={data.activeClients} l="Active clients" />
        <Stat n={data.activeDevices} l="Active devices" />
        <Stat n={data.activeDocumentSessions} l="Unlocked sessions" />
        <Stat n={formatBytes(data.storage.bytes)} l="Storage used" />
        <Stat n={data.failedEventsLast24h} l="Failed events (24h)" />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Recent security events</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Actor</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {data.recentEvents.map((e, i) => (
              <tr key={i}>
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
    </>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
