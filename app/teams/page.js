// All teams with their overall record
import { query, toNumbers } from '@/lib/db';
import DataTable from '@/components/DataTable';

export const dynamic = 'force-dynamic';

export default async function TeamsPage({ searchParams }) {
  const { region = '' } = await searchParams;
  const { rows } = await query(`
    SELECT t.team_id, t.name AS team, t.region,
           COUNT(DISTINCT mp.map_play_id) AS maps,
           ROUND(100.0 * COUNT(DISTINCT mp.map_play_id) FILTER (WHERE mp.winner_team_id = t.team_id)
                 / NULLIF(COUNT(DISTINCT mp.map_play_id), 0), 1) AS map_win_pct,
           MIN(tr.year) AS first_season, MAX(tr.year) AS last_season
    FROM teams t
    JOIN map_plays mp   ON t.team_id IN (mp.team_a_id, mp.team_b_id)
    JOIN series se      ON se.series_id = mp.series_id
    JOIN tournaments tr ON tr.tournament_id = se.tournament_id
    WHERE ($1::VARCHAR = '' OR t.region = $1::VARCHAR)
    GROUP BY t.team_id, t.name, t.region
    HAVING COUNT(DISTINCT mp.map_play_id) >= 5
    ORDER BY map_win_pct DESC`, [region]);

  return (
    <>
      <h1>Teams</h1>
      <p className="sub">{rows.length} teams with at least 5 maps, ordered by map win %.</p>
      <form className="filters">
        <select name="region" defaultValue={region}>
          <option value="">All regions</option>
          {['AMER', 'EMEA', 'PAC', 'CN'].map((r) => <option key={r}>{r}</option>)}
        </select>
        <button type="submit">Apply</button>
      </form>
      <div className="card">
        <DataTable rows={toNumbers(rows)} columns={['team', 'region', 'maps', 'map_win_pct', 'first_season', 'last_season']}
          links={{ team: (r) => `/teams/${r.team_id}` }} />
      </div>
    </>
  );
}
