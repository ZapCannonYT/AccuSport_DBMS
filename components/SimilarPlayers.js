'use client';
// Players with the most similar playstyle fingerprint (Qdrant vector search)
import { useEffect, useState } from 'react';
import DataTable from './DataTable';

export default function SimilarPlayers({ playerId }) {
  const [sameRole, setSameRole] = useState(true);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    fetch(`/api/similar/${playerId}?sameRole=${sameRole ? 1 : 0}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).error)))
      .then(setRows)
      .catch((e) => setError(String(e || 'Qdrant is not reachable.')));
  }, [playerId, sameRole]);

  return (
    <div className="card">
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Similar players (Qdrant)</h2>
        <label className="inline">
          <input type="checkbox" checked={sameRole} onChange={(e) => setSameRole(e.target.checked)} /> same main role
        </label>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>Cosine similarity of 4-number fingerprints: fragging, survival, damage, precision.</p>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Searching...</p>}
      {rows && <DataTable rows={rows} columns={['player', 'team', 'region', 'main_role', 'similarity']}
        links={{ player: (r) => `/players/${r.player_id}` }} empty="No similar players found." />}
    </div>
  );
}
