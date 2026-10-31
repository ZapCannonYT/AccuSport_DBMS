// Copies data from Postgres into two Qdrant collections. Postgres is the source of
// truth, so this can rebuild both collections at any time.
// Used by scripts/sync-qdrant.mjs (command line) and the admin page (web app).
//
//   playstyle  one vector per player (36 numbers):
//                 4 skill-category scores from v_player_fingerprint (fragging, survival, damage, precision)
//               + 3 extra stats (first kills / first deaths, first kills per round, ACS)
//               + how often the player used each of the 29 agents (share of their last 20 maps)
//              All stats are the average of the last 20 maps, z-scored against every player.
//   alerts     one vector per decline alert (17 numbers): how the player's 7 stats looked over the
//              10 maps up to the alert (z-score against their own baseline), which stat fired,
//              roster/role context and the form at that moment.
export const COLLECTION = 'playstyle';
export const ALERT_COLLECTION = 'alerts';

export const CATEGORY_NAMES = ['fragging', 'survival', 'damage', 'precision'];    // from v_player_fingerprint
export const EXTRA_STATS = ['fk_fd_ratio', 'first_kill_rate', 'acs'];            // z-scored here
export const PROFILE_STATS = [...CATEGORY_NAMES, ...EXTRA_STATS];                // first 7 numbers of a player vector
const AGENT_WEIGHT = 2;          // agent shares are 0..1, stats are about -2..2: weight them so neither side dominates

// The 7 stats CUSUM watches (everything except the vlr rating, which is the outcome)
export const ALERT_STATS = ['kills_per_round', 'kast_pct', 'adr', 'headshot_pct', 'fk_fd_ratio', 'first_kill_rate', 'acs'];
const ALERT_WINDOW = 10;         // maps up to and including the alert map

const recreate = async (qdrant, name, size) => {
  if ((await qdrant.collectionExists(name)).exists) await qdrant.deleteCollection(name);
  await qdrant.createCollection(name, { vectors: { size, distance: 'Cosine' } });
};
// Payload indexes make filtered searches fast (like SQL indexes on these fields)
const index = (qdrant, name, field, schema) => qdrant.createPayloadIndex(name, { field_name: field, field_schema: schema });
const upsertAll = async (qdrant, name, points) => {
  for (let i = 0; i < points.length; i += 256) await qdrant.upsert(name, { wait: true, points: points.slice(i, i + 256) });
};

export async function syncPlayers(pgQuery, qdrant) {
  const { rows: agents } = await pgQuery('SELECT agent_id FROM agents ORDER BY agent_id');
  const agentPos = new Map(agents.map((a, i) => [a.agent_id, PROFILE_STATS.length + i]));
  const size = PROFILE_STATS.length + agents.length;

  await recreate(qdrant, COLLECTION, size);
  await index(qdrant, COLLECTION, 'region', 'keyword');
  await index(qdrant, COLLECTION, 'main_role', 'keyword');
  await index(qdrant, COLLECTION, 'team', 'keyword');
  await index(qdrant, COLLECTION, 'maps', 'integer');
  await index(qdrant, COLLECTION, 'has_open_alert', 'bool');

  // The 4 category scores, plus who the player is
  const { rows } = await pgQuery(`
    SELECT f.player_id, f.vector, p.name, p.region, c.team, c.form,
           (SELECT COUNT(*) FROM map_participants pa WHERE pa.player_id = f.player_id)::INT AS maps,
           (SELECT MODE() WITHIN GROUP (ORDER BY pm.role)
            FROM (SELECT role FROM v_player_maps WHERE player_id = f.player_id
                  ORDER BY rn DESC LIMIT 20) pm) AS main_role,
           EXISTS (SELECT 1 FROM drift_alerts a WHERE a.player_id = f.player_id
                   AND a.direction = 'decline' AND a.status = 'open') AS has_open_alert
    FROM v_player_fingerprint f
    JOIN players p ON p.player_id = f.player_id
    LEFT JOIN v_player_current c ON c.player_id = f.player_id`);

  // 3 extra stats: average of the last 20 maps, z-scored across all players (same method as the view)
  const { rows: extras } = await pgQuery(`
    WITH last AS (SELECT player_id, MAX(rn) AS last_rn FROM v_player_maps GROUP BY player_id),
    avg AS (
      SELECT pm.player_id, md.code, md.higher_is_better, AVG(pm.value) AS avg_value
      FROM v_player_maps r
      JOIN last l ON l.player_id = r.player_id
      JOIN participant_metrics pm ON pm.player_id = r.player_id AND pm.map_play_id = r.map_play_id
      JOIN metric_definitions md ON md.metric_id = pm.metric_id
      WHERE r.rn > l.last_rn - 20 AND md.code = ANY($1)
      GROUP BY pm.player_id, md.code, md.higher_is_better)
    SELECT player_id, code,
           (CASE WHEN higher_is_better THEN 1 ELSE -1 END)
             * (avg_value - AVG(avg_value) OVER w) / NULLIF(STDDEV_POP(avg_value) OVER w, 0) AS z
    FROM avg WINDOW w AS (PARTITION BY code)`, [EXTRA_STATS]);

  // Agent usage: share of the last 20 maps played on each agent
  const { rows: shares } = await pgQuery(`
    WITH last AS (SELECT player_id, MAX(rn) AS last_rn FROM v_player_maps GROUP BY player_id)
    SELECT r.player_id, r.agent_id,
           COUNT(*)::float8 / (SUM(COUNT(*)) OVER (PARTITION BY r.player_id))::float8 AS share
    FROM v_player_maps r
    JOIN last l ON l.player_id = r.player_id
    WHERE r.rn > l.last_rn - 20
    GROUP BY r.player_id, r.agent_id`);

  const vectors = new Map(rows.map((r) => {
    const v = new Array(size).fill(0);
    r.vector.forEach((x, i) => { v[i] = Number(x); });
    return [r.player_id, v];
  }));
  for (const e of extras) {
    const v = vectors.get(e.player_id);
    if (v) v[CATEGORY_NAMES.length + EXTRA_STATS.indexOf(e.code)] = e.z === null ? 0 : Number(e.z);
  }
  for (const s of shares) {
    const v = vectors.get(s.player_id);
    if (v && agentPos.has(s.agent_id)) v[agentPos.get(s.agent_id)] = Number(s.share) * AGENT_WEIGHT;
  }

  const points = rows.map((r) => ({
    id: r.player_id,
    vector: vectors.get(r.player_id),
    payload: {
      player_id: r.player_id, name: r.name, region: r.region, team: r.team, maps: r.maps,
      main_role: r.main_role, form: r.form === null ? null : Number(r.form), has_open_alert: r.has_open_alert,
    },
  }));
  await upsertAll(qdrant, COLLECTION, points);
  const { count } = await qdrant.count(COLLECTION, { exact: true });
  return { synced: points.length, count, dimensions: size };
}

export async function syncAlerts(pgQuery, qdrant) {
  const size = ALERT_STATS.length * 2 + 2 + 1;      // 7 stat z-scores + 7 "which stat fired" + 2 context flags + form
  await recreate(qdrant, ALERT_COLLECTION, size);
  await index(qdrant, ALERT_COLLECTION, 'status', 'keyword');
  await index(qdrant, ALERT_COLLECTION, 'metric_code', 'keyword');
  await index(qdrant, ALERT_COLLECTION, 'context', 'keyword');
  await index(qdrant, ALERT_COLLECTION, 'player_id', 'integer');
  await index(qdrant, ALERT_COLLECTION, 'followed_by_form_drop', 'bool');

  // Each decline alert with the average of every stat over the last 10 maps up to the alert
  const { rows } = await pgQuery(`
    WITH pm AS MATERIALIZED (SELECT player_id, map_play_id, rn FROM v_player_maps),
    al AS (
      SELECT a.alert_id, a.player_id, p.name AS player, md.code AS metric_code, md.label AS metric,
             a.cusum_value, a.context, a.form_at_alert, a.status, a.review_note,
             (a.form_drop_map_play_id IS NOT NULL) AS followed_by_form_drop, pm.rn
      FROM drift_alerts a
      JOIN metric_definitions md ON md.metric_id = a.metric_id
      JOIN players p ON p.player_id = a.player_id
      JOIN pm ON pm.player_id = a.player_id AND pm.map_play_id = a.triggered_map_play_id
      WHERE a.direction = 'decline'),
    recent AS (
      SELECT al.alert_id, md.code, md.higher_is_better, AVG(v.value) AS avg_value
      FROM al
      JOIN pm r ON r.player_id = al.player_id AND r.rn BETWEEN al.rn - ${ALERT_WINDOW - 1} AND al.rn
      JOIN participant_metrics v ON v.player_id = r.player_id AND v.map_play_id = r.map_play_id
      JOIN metric_definitions md ON md.metric_id = v.metric_id
      WHERE md.code = ANY($1)
      GROUP BY al.alert_id, md.code, md.higher_is_better)
    SELECT al.*, rc.code, rc.higher_is_better, rc.avg_value
    FROM al LEFT JOIN recent rc ON rc.alert_id = al.alert_id`, [ALERT_STATS]);

  // The player's own baseline (learned from their first 20 maps) turns an average into a z-score
  const { rows: base } = await pgQuery(`
    SELECT cs.player_id, md.code, cs.baseline_mean, cs.n_baseline, cs.baseline_m2
    FROM cusum_state cs JOIN metric_definitions md ON md.metric_id = cs.metric_id
    WHERE md.code = ANY($1)`, [ALERT_STATS]);
  const baseline = new Map(base.map((b) => [`${b.player_id}:${b.code}`, {
    mean: Number(b.baseline_mean),
    std: b.n_baseline > 1 ? Math.max(Math.sqrt(Number(b.baseline_m2) / (b.n_baseline - 1)), 0.0001) : 1,
  }]));

  const alerts = new Map();
  for (const r of rows) {
    if (!alerts.has(r.alert_id)) alerts.set(r.alert_id, { ...r, z: new Array(ALERT_STATS.length).fill(0) });
    const a = alerts.get(r.alert_id);
    const b = baseline.get(`${r.player_id}:${r.code}`);
    if (r.code && b) {
      const z = ((Number(r.avg_value) - b.mean) / b.std) * (r.higher_is_better ? 1 : -1);
      a.z[ALERT_STATS.indexOf(r.code)] = Math.max(-5, Math.min(5, z));            // clamp so one odd stat cannot dominate
    }
  }

  const points = [...alerts.values()].map((a) => {
    const fired = new Array(ALERT_STATS.length).fill(0);
    const k = ALERT_STATS.indexOf(a.metric_code);
    if (k >= 0) fired[k] = 2;
    const v = [
      ...a.z, ...fired,
      a.context === 'team_change' ? 1.5 : 0, a.context === 'role_change' ? 1.5 : 0,
      ((a.form_at_alert === null ? 1000 : Number(a.form_at_alert)) - 1000) / 100,
    ];
    if (v.every((x) => x === 0)) v[v.length - 1] = 0.01;                          // cosine needs a non-zero vector
    return {
      id: a.alert_id,
      vector: v,
      payload: {
        alert_id: a.alert_id, player_id: a.player_id, player: a.player, metric_code: a.metric_code, metric: a.metric,
        cusum: Number(a.cusum_value), context: a.context, status: a.status, review_note: a.review_note,
        followed_by_form_drop: a.followed_by_form_drop,
      },
    };
  });
  await upsertAll(qdrant, ALERT_COLLECTION, points);
  const { count } = await qdrant.count(ALERT_COLLECTION, { exact: true });
  return { synced: points.length, count, dimensions: size };
}

export async function syncQdrant(pgQuery, qdrant) {
  const players = await syncPlayers(pgQuery, qdrant);
  const alerts = await syncAlerts(pgQuery, qdrant);
  return { players, alerts };
}
