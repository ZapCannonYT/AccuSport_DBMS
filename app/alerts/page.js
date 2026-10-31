'use client';
// Moderator alert queue: filter alerts, then acknowledge or resolve them
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Info from '@/components/Info';
import { YEARS } from '@/lib/reports';

const CONTEXT_LABEL = { team_change: 'after roster move', role_change: 'after role change' };

export default function AlertsPage() {
  const [filters, setFilters] = useState({ year: '', status: 'open', direction: 'decline', context: '', q: '' });
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

      <details className="card explain" style={{ marginBottom: 16 }}>
        <summary>How alerts work: what causes one, what "open" means, what CUSUM is</summary>

        <h3>What causes an alert?</h3>
        <p>For every player and every tracked stat (ACS, ADR, KAST, headshot %, first kills and so on) the database learns the player's <b>own normal</b> from their first 20 maps.
          After that, every new map is compared with that normal and the gap is turned into a score <code>z</code> (how many standard deviations better or worse than usual).</p>
        <p>A worse-than-normal map adds to a running total. A normal or better map takes some away, and a small amount (0.5 standard deviations) is always forgiven, so ordinary ups and downs never build up.
          When the running total passes <b>5</b>, the trigger raises an alert and resets the total to 0.</p>
        <p>So one terrible map does nothing, but a steady slide over many maps does. An <b>improve</b> alert is the same thing in the other direction.
          Alerts are raised automatically inside the database, in the same transaction that saves the map.</p>
        <p><b>Context</b>: <i>after roster move</i> = the player changed team in their last 5 maps; <i>after role change</i> = they played a different agent role from their usual one in the last 10 maps. A dip after either is expected and is not necessarily a skill problem.</p>

        <h3>What does "open" mean?</h3>
        <ul>
          <li><b>open</b>: raised by the detector and nobody has looked at it yet. This is the to-do list.</li>
          <li><b>acknowledged</b>: a moderator has seen it and is checking it.</li>
          <li><b>resolved</b>: reviewed and closed, with an optional note. <i>Reopen</i> puts it back to open.</li>
        </ul>
        <p>While an alert is open for a player, stat and direction, the detector will not raise a duplicate, so the queue is not flooded.
          The dashboard's "Open decline alerts" counts the open ones.</p>

        <h3>What does CUSUM mean?</h3>
        <p><b>CUSUM = cumulative sum.</b> It is a method from factory quality control (E. S. Page, 1954) for catching a machine that is slowly drifting out of calibration, even though no single product is bad enough to reject.
          Here the "machine" is a player's performance.</p>
        <p>The <b>CUSUM</b> column is the running total at the moment the alert fired. It is always just above the threshold of 5; a higher number means the last map pushed it further past the threshold.</p>
      </details>
      <div className="filters">
        <select value={filters.year} onChange={set('year')}>
          <option value="">All seasons</option>
          {YEARS.map((y) => <option key={y} value={y}>{y}{y === 2026 ? ' (partial)' : ''}</option>)}
        </select>
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
              <th>Player</th><th>Metric</th><th>Direction</th>
              <th className="num">CUSUM<Info><p><b>Cumulative sum.</b> The running total of how far below the player's own normal they have been, at the moment the alert fired.</p><p>It must pass 5 to raise an alert. One bad map adds little; many slightly bad maps add up.</p></Info></th>
              <th>Context</th><th>Tournament</th><th>Map</th>
              <th>Status<Info><p><b>open</b> = nobody has reviewed it yet.</p><p><b>acknowledged</b> = a moderator has seen it.</p><p><b>resolved</b> = reviewed and closed.</p></Info></th><th>Reviewed by</th><th>Actions</th>
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
