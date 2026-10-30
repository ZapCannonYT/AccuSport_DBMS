'use client';
// Admin: app accounts (INSERT / DELETE), metric definitions (UPDATE), maintenance
import { useCallback, useEffect, useState } from 'react';
import DataTable from '@/components/DataTable';

const EMPTY = { email: '', display_name: '', role: 'analyst', password: '' };

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/users').then((r) => r.json()).then(setUsers);
    fetch('/api/admin/metrics').then((r) => r.json()).then(setMetrics);
  }, []);
  useEffect(load, [load]);

  async function call(url, method, body) {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setMessage(res.ok ? (data.message || 'Saved.') : (data.error || 'Request failed.'));
    load();
    return res.ok;
  }

  async function addUser(e) {
    e.preventDefault();
    if (await call('/api/admin/users', 'POST', form)) setForm(EMPTY);
  }

  async function maintenance(action) {
    setBusy(true);
    await call('/api/admin/maintenance', 'POST', { action });
    setBusy(false);
  }

  return (
    <>
      <h1>Admin</h1>
      <p className="sub">Manage app accounts and metric definitions. Every rule is also enforced by the database.</p>
      {message && <div className="notice">{message}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h2>App accounts</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Follows</th><th /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td>{u.email}</td><td>{u.display_name}</td><td><span className="badge">{u.role}</span></td>
                    <td>{u.follows || <span className="muted">-</span>}</td>
                    <td><button className="secondary" onClick={() => window.confirm(`Delete ${u.email}?`) && call(`/api/admin/users/${u.user_id}`, 'DELETE')}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 style={{ marginTop: 16 }}>Add account</h3>
          <form className="filters" onSubmit={addUser}>
            <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Display name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="analyst">analyst</option><option value="moderator">moderator</option><option value="admin">admin</option>
            </select>
            <input type="password" placeholder="Password (8+ chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="submit">Add</button>
          </form>
        </div>

        <div className="card">
          <h2>Maintenance</h2>
          <p className="muted">Qdrant only holds a copy of Postgres data, so it can always be rebuilt.</p>
          <div className="filters">
            <button disabled={busy} onClick={() => maintenance('sync-qdrant')}>Re-sync Qdrant</button>
            <button className="secondary" disabled={busy} onClick={() => maintenance('refresh-leaderboard')}>Refresh leaderboard view</button>
          </div>
        </div>
      </div>

      <div className="card section">
        <h2>Metric definitions</h2>
        <p className="muted">Unticking "monitored" stops the CUSUM trigger from watching that metric for newly imported maps.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Label</th><th>Category</th><th>Higher is better</th><th className="num">Values</th><th className="num">Alerts</th><th>Monitored</th></tr></thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.metric_id}>
                  <td>{m.code}</td>
                  <td>{m.label}</td>
                  <td>{m.category || <span className="muted">valorant-specific</span>}</td>
                  <td>{m.higher_is_better ? 'yes' : 'no'}</td>
                  <td className="num">{m.values_stored.toLocaleString()}</td>
                  <td className="num">{m.alerts}</td>
                  <td><input type="checkbox" checked={m.monitored}
                    onChange={(e) => call(`/api/admin/metrics/${m.metric_id}`, 'PATCH', { monitored: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
