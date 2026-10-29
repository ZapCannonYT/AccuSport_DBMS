'use client';
// Moderator alert queue: filter alerts, then acknowledge or resolve them
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

const CONTEXT_LABEL = { team_change: 'after roster move', role_change: 'after role change' };

export default function AlertsPage() {
  const [filters, setFilters] = useState({ status: 'open', direction: 'decline', context: '', q: '' });
  const [rows, setRows] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    fetch(`/api/alerts?${params}`).then((r) => r.json()).then(setRows);
  }, [filters]);
  useEffect(load, [load]);

  async function review(alert, status) {
    const note = status === 'resolved' ? window.prompt('Resolution note (optional):', '') : null;
    if (note === null && status === 'resolved') return;
    const res = await fetch(`/api/alerts/${alert.alert_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, note }),
    });
    setMessage(res.ok ? `Alert ${alert.alert_id} marked ${status}.` : 'Update failed.');
    load();
  }

  const set = (key) => (e) => setFilters({ ...filters, [key]: e.target.value });
  return (
    <>
      <h1>Alert queue</h1>
      <p className="sub">Alerts raised by the CUSUM trigger. Context shows whether a roster move or role change happened just before.</p>
      <div className="filters">
        <select value={filters.status} onChange={set('status')}>
          <option value="">Any status</option><option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option>
        </select>
        <select value={filters.direction} onChange={set('direction')}>
          <option value="">Both directions</option><option value="decline">Decline</option><option value="improve">Improve</option>
        </select>
        <select value={filters.context} onChange={set('context')}>
          <option value="">Any context</option><option value="team_change">After roster move</option>
          <option value="role_change">After role change</option><option value="none">No context</option>
        </select>
        <input placeholder="Player" value={filters.q} onChange={set('q')} />
      </div>
      {message && <div className="notice">{message}</div>}
      <div className="card table-wrap">
        {!rows ? <p className="muted">Loading...</p> : !rows.length ? <p className="muted">No alerts match.</p> : (
          <table>
            <thead><tr>
              <th>Player</th><th>Metric</th><th>Direction</th><th className="num">CUSUM</th><th>Context</th>
              <th>Tournament</th><th>Map</th><th>Status</th><th>Reviewed by</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.alert_id}>
                  <td><Link href={`/players/${a.player_id}`}>{a.player}</Link></td>
                  <td>{a.metric}</td>
                  <td><span className={`badge ${a.direction}`}>{a.direction}</span></td>
                  <td className="num">{a.cusum}</td>
                  <td>{CONTEXT_LABEL[a.context] || <span className="muted">-</span>}</td>
                  <td>{a.tournament}</td>
                  <td>{a.map}</td>
                  <td><span className={`badge ${a.status}`}>{a.status}</span></td>
                  <td>{a.reviewed_by || <span className="muted">-</span>}{a.review_note && <div className="muted">{a.review_note}</div>}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {a.status === 'open' && <button className="secondary" onClick={() => review(a, 'acknowledged')}>Acknowledge</button>}
                    {a.status !== 'resolved' && <button onClick={() => review(a, 'resolved')}>Resolve</button>}
                    {a.status === 'resolved' && <button className="secondary" onClick={() => review(a, 'open')}>Reopen</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
