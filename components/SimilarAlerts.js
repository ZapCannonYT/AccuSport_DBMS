'use client';
// "Alerts that looked like this one" for the moderator queue (Qdrant vector search over alert patterns)
import { useEffect, useState } from 'react';
import DataTable from './DataTable';

export default function SimilarAlerts({ alertId }) {
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    fetch(`/api/alerts/${alertId}/similar?reviewedOnly=${reviewedOnly ? 1 : 0}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject((await r.json()).error)))
      .then(setData)
      .catch((e) => setError(String(e || 'Qdrant is not reachable.')));
  }, [alertId, reviewedOnly]);

  return (
    <div style={{ padding: '6px 4px' }}>
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <strong>Similar past alerts (Qdrant)</strong>
        <label className="inline"><input type="checkbox" checked={reviewedOnly} onChange={(e) => setReviewedOnly(e.target.checked)} /> reviewed only</label>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">Searching...</p>}
      {data && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {data.total ? <><b>{data.followed} of {data.total}</b> similar alerts were followed by a real form drop (50+ points). </> : null}
            Similarity compares how the player's 7 stats looked over the 10 maps before the alert, which stat fired, any roster or role change, and their form.
          </p>
          <DataTable rows={data.rows} columns={['player', 'metric', 'similarity', 'status', 'review_note', 'form_dropped_after', 'context']}
            links={{ player: (r) => `/players/${r.player_id}` }} empty="No similar alerts found." />
        </>
      )}
    </div>
  );
}
