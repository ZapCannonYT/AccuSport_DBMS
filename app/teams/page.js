// All teams with their overall record; filters keep tiny samples from skewing the table
import Link from 'next/link';
import { query, toNumbers } from '@/lib/db';
import DataTable from '@/components/DataTable';
import Info from '@/components/Info';
import { YEARS } from '@/lib/reports';

export const dynamic = 'force-dynamic';
const REGIONS = ['AMER', 'EMEA', 'PAC', 'CN'];
const SORTS = {
  win: ['Map win %', 'map_win_pct DESC NULLS LAST'],
  maps: ['Most maps', 'maps DESC'],
  acs: ['Highest ACS', 'a.avg_acs DESC NULLS LAST'],
  name: ['Name', 'lower(t.name)'],
};
const list = (v) => [].concat(v ?? []).filter(Boolean);
const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export default async function TeamsPage({ searchParams }) {
  const sp = await searchParams;
  const q = sp.q || '';
  const regions = list(sp.region).filter((r) => REGIONS.includes(r));
  const minMaps = Math.max(1, num(sp.minMaps) ?? 5);
  const [maxMaps, minWin, maxWin, minAcs] = ['maxMaps', 'minWin', 'maxWin', 'minAcs'].map((k) => num(sp[k]));
  const sort = SORTS[sp.sort] ? sp.sort : 'win';
  const year = YEARS.includes(Number(sp.year)) ? Number(sp.year) : null;   // null = all seasons

  const values = [minMaps];
  const where = [];
  const having = ['COUNT(DISTINCT mp.map_play_id) >= $1'];
  const add = (target, sql, v) => { values.push(v); target.push(sql.replace('?', `$${values.length}`)); };
  if (year) add(where, 'tr.year = ?', year);
  const yearParam = year ? `$${values.length}` : null;
  if (q) add(where, 't.name ILIKE ?', `%${q}%`);
  if (regions.length) add(where, 't.region = ANY(?::text[])', regions);
  if (minAcs !== null) add(where, 'a.avg_acs >= ?', minAcs);
  if (maxMaps !== null) add(having, 'COUNT(DISTINCT mp.map_play_id) <= ?', maxMaps);
  const winExpr = '100.0 * COUNT(DISTINCT mp.map_play_id) FILTER (WHERE mp.winner_team_id = t.team_id) / NULLIF(COUNT(DISTINCT mp.map_play_id), 0)';
  if (minWin !== null) add(having, `${winExpr} >= ?`, minWin);
  if (maxWin !== null) add(having, `${winExpr} <= ?`, maxWin);

  const { rows } = await query(`
    SELECT t.team_id, t.name AS team, t.region,
           COUNT(DISTINCT mp.map_play_id) AS maps,
           ROUND(${winExpr}, 1) AS map_win_pct,
           a.avg_acs,
           MIN(tr.year) AS first_season, MAX(tr.year) AS last_season
    FROM teams t
    JOIN map_plays mp   ON t.team_id IN (mp.team_a_id, mp.team_b_id)
    JOIN series se      ON se.series_id = mp.series_id
    JOIN tournaments tr ON tr.tournament_id = se.tournament_id
    LEFT JOIN (SELECT team_id, ROUND(AVG(value), 1) AS avg_acs
               FROM v_metric_values WHERE code = 'acs' ${yearParam ? `AND year = ${yearParam}` : ''}
               GROUP BY team_id) a ON a.team_id = t.team_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    GROUP BY t.team_id, t.name, t.region, a.avg_acs
    HAVING ${having.join(' AND ')}
    ORDER BY ${SORTS[sort][1]}, t.team_id`, values);

  return (
    <>
      <h1>Teams</h1>
      <div className="sub" style={{ marginBottom: 20 }}>
        {rows.length} teams with at least {minMaps} maps{year ? ` in ${year}` : ''}.
        <Info>
          <p><b>map_win_pct</b> = share of the team's maps that it won. <b>avg_acs</b> = average combat score of the team's players on those maps.</p>
          <p>A team with 5 maps can show 80% or 20% by luck. Raise <b>Min maps</b> to compare teams with a real sample.</p>
        </Info>
      </div>
      <form className="card" style={{ marginBottom: 16 }}>
        <div className="filter-grid">
          <label className="field">Season
            <select name="year" defaultValue={year ?? ''}>
              <option value="">All seasons</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}{y === 2026 ? ' (partial)' : ''}</option>)}
            </select>
          </label>
          <label className="field">Team<input name="q" placeholder="Name contains" defaultValue={q} /></label>
          <div className="field">Region
            <div className="checks">{REGIONS.map((r) => (
              <label key={r}><input type="checkbox" name="region" value={r} defaultChecked={regions.includes(r)} />{r}</label>))}</div>
          </div>
          <label className="field">Min maps<input type="number" min="1" name="minMaps" defaultValue={minMaps} /></label>
          <label className="field">Max maps<input type="number" min="0" name="maxMaps" defaultValue={maxMaps ?? ''} /></label>
          <label className="field">Min win %<input type="number" name="minWin" defaultValue={minWin ?? ''} /></label>
          <label className="field">Max win %<input type="number" name="maxWin" defaultValue={maxWin ?? ''} /></label>
          <label className="field">Min ACS<input type="number" min="0" name="minAcs" defaultValue={minAcs ?? ''} /></label>
          <label className="field">Sort
            <select name="sort" defaultValue={sort}>
              {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <div className="filters" style={{ margin: 0 }}>
            <button type="submit">Apply</button>
            <Link href="/teams">Reset</Link>
          </div>
        </div>
      </form>
      <div className="card">
        <DataTable rows={toNumbers(rows)} columns={['team', 'region', 'maps', 'map_win_pct', 'avg_acs', 'first_season', 'last_season']}
          links={{ team: (r) => `/teams/${r.team_id}` }} empty="No teams match these filters." />
      </div>
    </>
  );
}
