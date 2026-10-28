// Copies every playstyle fingerprint from Postgres (v_player_fingerprint) into Qdrant.
// Postgres is the source of truth, so this can rebuild the collection at any time.
// Used by scripts/sync-qdrant.mjs (command line) and the admin page (web app).
export const COLLECTION = 'playstyle';

export async function syncQdrant(pgQuery, qdrant) {
  // Recreate the collection: 4-dimensional vectors compared by cosine similarity
  if ((await qdrant.collectionExists(COLLECTION)).exists) {
    await qdrant.deleteCollection(COLLECTION);
  }
  await qdrant.createCollection(COLLECTION, { vectors: { size: 4, distance: 'Cosine' } });

  // Payload indexes make filtered searches fast (like SQL indexes on these fields)
  await qdrant.createPayloadIndex(COLLECTION, { field_name: 'region', field_schema: 'keyword' });
  await qdrant.createPayloadIndex(COLLECTION, { field_name: 'main_role', field_schema: 'keyword' });
  await qdrant.createPayloadIndex(COLLECTION, { field_name: 'has_open_alert', field_schema: 'bool' });

  const { rows } = await pgQuery(`
    SELECT f.player_id, f.vector, p.name, p.region, c.team, c.form,
           (SELECT MODE() WITHIN GROUP (ORDER BY pm.role)
            FROM (SELECT role FROM v_player_maps WHERE player_id = f.player_id
                  ORDER BY rn DESC LIMIT 20) pm) AS main_role,
           EXISTS (SELECT 1 FROM drift_alerts a WHERE a.player_id = f.player_id
                   AND a.direction = 'decline' AND a.status = 'open') AS has_open_alert
    FROM v_player_fingerprint f
    JOIN players p ON p.player_id = f.player_id
    LEFT JOIN v_player_current c ON c.player_id = f.player_id`);

  const points = rows.map((r) => ({
    id: r.player_id,
    vector: r.vector.map(Number),
    payload: {
      player_id: r.player_id, name: r.name, region: r.region, team: r.team,
      main_role: r.main_role, form: r.form === null ? null : Number(r.form), has_open_alert: r.has_open_alert,
    },
  }));
  for (let i = 0; i < points.length; i += 256) {
    await qdrant.upsert(COLLECTION, { wait: true, points: points.slice(i, i + 256) });
  }
  const { count } = await qdrant.count(COLLECTION, { exact: true });
  return { synced: points.length, count };
}
