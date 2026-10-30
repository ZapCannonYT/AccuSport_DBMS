// One team: season stats, roster per season, recent series
import { notFound } from 'next/navigation';
import { query, toNumbers } from '@/lib/db';
import DataTable from '@/components/DataTable';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) notFound();
  const { rows: [team] } = await query('SELECT team_id, name, region, vlr_team_id FROM teams WHERE team_id = $1', [teamId]);
  if (!team) notFound();

  const [seasons, roster, recent] = await Promise.all([
    query(`SELECT year, maps_played, map_win_pct, avg_kast_pct, avg_adr, avg_acs, avg_rating
           FROM v_report_team_stats WHERE team = $1 ORDER BY year DESC`, [team.name]),
    query(`SELECT tr.year, p.player_id, p.name AS player, COUNT(*) AS maps,
                  MODE() WITHIN GROUP (ORDER BY ag.role) AS main_role
           FROM map_participants pa
           JOIN players p      ON p.player_id = pa.player_id
           JOIN agents ag      ON ag.agent_id = pa.agent_id
           JOIN map_plays mp   ON mp.map_play_id = pa.map_play_id
           JOIN series se      ON se.series_id = mp.series_id
           JOIN tournaments tr ON tr.tournament_id = se.tournament_id
           WHERE pa.team_id = $1
           GROUP BY tr.year, p.player_id, p.name
           ORDER BY tr.year DESC, maps DESC`, [teamId]),
    query(`SELECT tr.name AS tournament, se.stage, se.match_type,
                  ta.name AS team_a, se.team_a_score, se.team_b_score, tb.name AS team_b
           FROM series se
           JOIN tournaments tr ON tr.tournament_id = se.tournament_id
           JOIN teams ta ON ta.team_id = se.team_a_id
           JOIN teams tb ON tb.team_id = se.team_b_id
           WHERE $1 IN (se.team_a_id, se.team_b_id)
           ORDER BY se.vlr_match_id DESC LIMIT 15`, [teamId]),
  ]);

  return (
    <>
      <h1>{team.name}</h1>
      <p className="sub">{team.region}{team.vlr_team_id && <> - <a href={`https://www.vlr.gg/team/${team.vlr_team_id}`} target="_blank" rel="noreferrer">vlr.gg page</a></>}</p>
      <div className="card"><h2>Seasons</h2><DataTable rows={toNumbers(seasons.rows)} empty="Fewer than 10 maps in every season." /></div>
      <div className="grid cols-2 section">
        <div className="card">
          <h2>Roster by season</h2>
          <DataTable rows={toNumbers(roster.rows)} columns={['year', 'player', 'maps', 'main_role']}
            links={{ player: (r) => `/players/${r.player_id}` }} />
        </div>
        <div className="card"><h2>Recent series</h2><DataTable rows={toNumbers(recent.rows)} /></div>
      </div>
    </>
  );
}
