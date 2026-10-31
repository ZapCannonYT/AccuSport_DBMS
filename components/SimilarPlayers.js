'use client';
// Players with the most similar playstyle profile (Qdrant vector search with payload filters)
import { useEffect, useState } from 'react';
import DataTable from './DataTable';
import Info from './Info';

export default function SimilarPlayers({ playerId }) {
  const [f, setF] = useState({ sameRole: true, sameRegion: false, otherTeams: false, minMaps: '' });
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    const qs = new URLSearchParams({
      sameRole: f.sameRole ? 1 : 0, sameRegion: f.sameRegion ? 1 : 0, otherTeams: f.otherTeams ? 1 : 0, minMaps: f.minMaps || 0,
    });
    fetch(`/api/similar/${playerId}?${qs}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).error)))
      .then(setRows)
      .catch((e) => setError(String(e || 'Qdrant is not reachable.')));
  }, [playerId, f]);

  const toggle = (key) => (e) => setF({ ...f, [key]: e.target.checked });
  return (
    <div className="card">
      <h2 style={{ marginBottom: 8 }}>Similar players (Qdrant)
        <Info>
          <p>Each player is a list of <b>36 numbers</b> built from their last 20 maps: 7 stats (kills, KAST, damage, headshots, first kills, ACS) compared with every other player, plus how often they play each of the 29 agents.</p>
          <p>Qdrant finds the profiles pointing in the most similar direction (cosine similarity, 1.0 = identical). The tick boxes are filters applied inside the vector search.</p>
        </Info>
      </h2>
      <div className="filters">
        <label className="inline"><input type="checkbox" checked={f.sameRole} onChange={toggle('sameRole')} /> same main role</label>
        <label className="inline"><input type="checkbox" checked={f.sameRegion} onChange={toggle('sameRegion')} /> same region</label>
        <label className="inline"><input type="checkbox" checked={f.otherTeams} onChange={toggle('otherTeams')} /> other teams only</label>
        <label className="inline">min maps
          <input type="number" min="0" style={{ width: 70 }} value={f.minMaps} onChange={(e) => setF({ ...f, minMaps: e.target.value })} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">Searching...</p>}
      {rows && <DataTable rows={rows} columns={['player', 'team', 'region', 'main_role', 'maps', 'similarity']}
        links={{ player: (r) => `/players/${r.player_id}` }} empty="No similar players found." />}
    </div>
  );
}
