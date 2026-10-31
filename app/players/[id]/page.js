// One player's profile: form, metric charts with CUSUM alerts, alerts, agents,
// seasons, recent maps and similar players (Qdrant)
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { query, toNumbers } from '@/lib/db';
import { getSession } from '@/lib/auth';
import DataTable from '@/components/DataTable';
import PlayerCharts from '@/components/PlayerCharts';
import SimilarPlayers from '@/components/SimilarPlayers';
import FollowButton from '@/components/FollowButton';
import Info from '@/components/Info';

export const dynamic = 'force-dynamic';

export default async function PlayerPage({ params }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isInteger(playerId)) notFound();
  const session = await getSession();

  const { rows: [player] } = await query(`
    SELECT p.player_id, p.name, p.region, p.vlr_player_id, c.team, c.form,
           (SELECT COUNT(*) FROM map_participants WHERE player_id = p.player_id) AS maps,
           (SELECT MODE() WITHIN GROUP (ORDER BY role) FROM v_player_maps WHERE player_id = p.player_id) AS main_role,
           (SELECT followed_player_id FROM users WHERE user_id = $2) = p.player_id AS following
    FROM players p LEFT JOIN v_player_current c ON c.player_id = p.player_id
    WHERE p.player_id = $1`, [playerId, session.user.id]);
  if (!player) notFound();

  const [series, forms, alerts, agents, seasons, recent] = await Promise.all([
    query(`SELECT pm.rn, md.code, md.label, v.value
           FROM participant_metrics v
           JOIN metric_definitions md ON md.metric_id = v.metric_id
           JOIN v_player_maps pm ON pm.player_id = v.player_id AND pm.map_play_id = v.map_play_id
           WHERE v.player_id = $1 ORDER BY pm.rn`, [playerId]),
    query(`SELECT pm.rn, f.form
           FROM form_ratings f JOIN v_player_maps pm ON pm.player_id = f.player_id AND pm.map_play_id = f.map_play_id
           WHERE f.player_id = $1 ORDER BY pm.rn`, [playerId]),
    query(`SELECT a.alert_id, a.metric_code, a.metric, a.direction, ROUND(a.cusum_value, 2) AS cusum, a.context,
                  a.status, a.tournament, a.map, a.started_at AS approx_date, pm.rn
           FROM v_alert_details a
           JOIN v_player_maps pm ON pm.player_id = a.player_id AND pm.map_play_id = a.triggered_map_play_id
           WHERE a.player_id = $1 ORDER BY pm.rn DESC`, [playerId]),
    query(`SELECT ag.name AS agent, ag.role, COUNT(*) AS maps,
                  ROUND(100.0 * AVG(CASE WHEN pa.result = 'win' THEN 1 ELSE 0 END), 1) AS win_pct
           FROM map_participants pa JOIN agents ag ON ag.agent_id = pa.agent_id
           WHERE pa.player_id = $1 GROUP BY ag.name, ag.role ORDER BY maps DESC`, [playerId]),
    query(`SELECT year, COUNT(DISTINCT map_play_id) AS maps,
                  ROUND(AVG(value) FILTER (WHERE code = 'vlr_rating'), 3) AS avg_rating,
                  ROUND(AVG(value) FILTER (WHERE code = 'acs'), 1) AS avg_acs,
                  ROUND(AVG(value) FILTER (WHERE code = 'kast_pct'), 1) AS avg_kast_pct,
                  ROUND(AVG(value) FILTER (WHERE code = 'adr'), 1) AS avg_adr
           FROM v_metric_values WHERE player_id = $1 GROUP BY year ORDER BY year`, [playerId]),
    query(`SELECT mp.started_at AS approx_date, tr.name AS tournament, m.name AS map, t.name AS team,
                  ag.name AS agent, pa.result,
                  MAX(v.value) FILTER (WHERE md.code = 'vlr_rating') AS rating,
                  MAX(v.value) FILTER (WHERE md.code = 'acs') AS acs,
                  MAX(v.value) FILTER (WHERE md.code = 'kast_pct') AS kast_pct
           FROM map_participants pa
           JOIN map_plays mp ON mp.map_play_id = pa.map_play_id
           JOIN maps m ON m.map_id = mp.map_id
           JOIN series se ON se.series_id = mp.series_id
           JOIN tournaments tr ON tr.tournament_id = se.tournament_id
           JOIN teams t ON t.team_id = pa.team_id
           JOIN agents ag ON ag.agent_id = pa.agent_id
           LEFT JOIN participant_metrics v ON v.map_play_id = pa.map_play_id AND v.player_id = pa.player_id
           LEFT JOIN metric_definitions md ON md.metric_id = v.metric_id
           WHERE pa.player_id = $1
           GROUP BY mp.map_play_id, mp.started_at, tr.name, m.name, t.name, ag.name, pa.result
           ORDER BY mp.started_at DESC LIMIT 15`, [playerId]),
  ]);

  // One series per metric for the chart: [{ code, label, points: [{ rn, value }] }]
  const metrics = {};
  for (const r of toNumbers(series.rows)) {
    metrics[r.code] ??= { code: r.code, label: r.label, points: [] };
    metrics[r.code].points.push({ map: r.rn, value: r.value });
  }
  const alertRows = toNumbers(alerts.rows);

  return (
    <>
      <div className="filters" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{player.name}</h1>
          <p className="sub" style={{ marginBottom: 0 }}>
            {player.team ?? 'No team'} - {player.region} - main role <span className="badge role">{player.main_role ?? '-'}</span>
            {' '}- {Number(player.maps)} maps - form {player.form ?? '-'}
            {player.vlr_player_id && <> - <a href={`https://www.vlr.gg/player/${player.vlr_player_id}`} target="_blank" rel="noreferrer">vlr.gg profile</a></>}
          </p>
        </div>
        <FollowButton playerId={player.player_id} following={!!player.following} />
      </div>

      <div className="section">
        <PlayerCharts forms={toNumbers(forms.rows).map((f) => ({ map: f.rn, form: f.form }))}
          metrics={Object.values(metrics)} alerts={alertRows.map((a) => ({ code: a.metric_code, map: a.rn, direction: a.direction }))} />
      </div>

      <div className="grid cols-2 section">
        <div className="card">
          <h2>CUSUM alerts<Info>
            <p>An alert means this stat has been running below (decline) or above (improve) the player's <i>own</i> normal for a sustained stretch, not just one map.</p>
            <p><b>cusum</b> = the running total when it fired (the threshold is 5). <b>context</b> = a roster move or role change shortly before. <b>status</b>: open = not reviewed yet.</p>
          </Info></h2>
          <DataTable rows={alertRows.map(({ metric_code: _c, rn, ...a }) => ({ ...a, map_no: rn }))}
            columns={['metric', 'direction', 'cusum', 'context', 'status', 'tournament', 'map_no']}
            empty="No alerts for this player." />
        </div>
        <SimilarPlayers playerId={player.player_id} />
        <div className="card">
          <h2>Seasons</h2>
          <DataTable rows={toNumbers(seasons.rows)} />
        </div>
        <div className="card">
          <h2>Agents played</h2>
          <DataTable rows={toNumbers(agents.rows)} />
        </div>
      </div>

      <div className="card section">
        <h2>Recent maps</h2>
        <DataTable rows={toNumbers(recent.rows)} />
        <p className="muted">Dates are estimated from vlr.gg game order; the order is exact.</p>
      </div>
      <p><Link href="/players">Back to players</Link></p>
    </>
  );
}
