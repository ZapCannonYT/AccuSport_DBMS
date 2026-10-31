// Player list with search, several combinable filters and pagination (all done in SQL)
import Link from 'next/link';
import { query } from '@/lib/db';
import DataTable from '@/components/DataTable';
import Info from '@/components/Info';
import { YEARS } from '@/lib/reports';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 25;
const REGIONS = ['AMER', 'EMEA', 'PAC', 'CN', 'INTL'];
const ROLES = ['duelist', 'initiator', 'controller', 'sentinel'];
const SORTS = {
  form: ['Best form', 'c.form DESC NULLS LAST'],
  acs: ['Highest ACS', 's.avg_acs DESC NULLS LAST'],
  maps: ['Most maps', 'COALESCE(m.maps, 0) DESC'],
  alerts: ['Most open alerts', 'COALESCE(al.open_alerts, 0) DESC, c.form DESC NULLS LAST'],
  name: ['Name', 'lower(p.name)'],
};

const list = (v) => [].concat(v ?? []).filter(Boolean);                       // ?region=A&region=B -> ['A','B']
const num = (v) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export default async function PlayersPage({ searchParams }) {
  const sp = await searchParams;
  const q = sp.q || '', team = sp.team || '', alertsF = sp.alerts || '';
  const regions = list(sp.region).filter((r) => REGIONS.includes(r));
  const roles = list(sp.role).filter((r) => ROLES.includes(r));
  const [minMaps, maxMaps, minForm, maxForm, minAcs] = ['minMaps', 'maxMaps', 'minForm', 'maxForm', 'minAcs'].map((k) => num(sp[k]));
  const sort = SORTS[sp.sort] ? sp.sort : 'form';
  const page = Math.max(1, Number(sp.page) || 1);
  const year = YEARS.includes(Number(sp.year)) ? Number(sp.year) : null;   // null = all seasons

  const values = year ? [year] : [];                                        // $1 = season when set
  const where = year ? ['COALESCE(m.maps, 0) > 0'] : [];
  const add = (sql, v) => { values.push(v); where.push(sql.replace('?', `$${values.length}`)); };
  if (q) add('p.name ILIKE ?', `%${q}%`);
  if (team) add('c.team ILIKE ?', `%${team}%`);
  if (regions.length) add('p.region = ANY(?::text[])', regions);
  if (roles.length) add('r.main_role = ANY(?::text[])', roles);
  if (minMaps !== null) add('COALESCE(m.maps, 0) >= ?', minMaps);
  if (maxMaps !== null) add('COALESCE(m.maps, 0) <= ?', maxMaps);
  if (minForm !== null) add('c.form >= ?', minForm);
  if (maxForm !== null) add('c.form <= ?', maxForm);
  if (minAcs !== null) add('s.avg_acs >= ?', minAcs);
  if (alertsF === 'with') where.push('COALESCE(al.open_alerts, 0) > 0');
  if (alertsF === 'none') where.push('COALESCE(al.open_alerts, 0) = 0');
  values.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const { rows } = await query(`
    SELECT p.player_id, p.name AS player, p.region, c.team, r.main_role AS role, c.form, s.avg_acs,
           COALESCE(m.maps, 0)::INT AS maps,
           COALESCE(al.open_alerts, 0)::INT AS open_alerts,
           COUNT(*) OVER () AS total
    FROM players p
    LEFT JOIN ${year ? `(SELECT DISTINCT ON (f.player_id) f.player_id, t.name AS team, f.form
               FROM form_ratings f
               JOIN map_participants pa ON pa.map_play_id = f.map_play_id AND pa.player_id = f.player_id
               JOIN teams t ON t.team_id = pa.team_id
               JOIN map_plays mp ON mp.map_play_id = f.map_play_id
               JOIN series se ON se.series_id = mp.series_id
               JOIN tournaments tr ON tr.tournament_id = se.tournament_id
               WHERE tr.year = $1
               ORDER BY f.player_id, f.recorded_at DESC, f.map_play_id DESC)` : 'v_player_current'} c
           ON c.player_id = p.player_id
    LEFT JOIN (SELECT player_id, COUNT(*) AS maps FROM v_player_maps ${year ? 'WHERE year = $1' : ''} GROUP BY player_id) m
           ON m.player_id = p.player_id
    LEFT JOIN (SELECT player_id, MODE() WITHIN GROUP (ORDER BY role) AS main_role
               FROM v_player_maps ${year ? 'WHERE year = $1' : ''} GROUP BY player_id) r
           ON r.player_id = p.player_id
    LEFT JOIN (SELECT player_id, ROUND(AVG(value), 1) AS avg_acs
               FROM v_metric_values WHERE code = 'acs' ${year ? 'AND year = $1' : ''} GROUP BY player_id) s
           ON s.player_id = p.player_id
    LEFT JOIN (SELECT player_id, COUNT(*) AS open_alerts FROM v_alert_details
               WHERE direction = 'decline' AND status = 'open' ${year ? 'AND year = $1' : ''} GROUP BY player_id) al
           ON al.player_id = p.player_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${SORTS[sort][1]}, p.player_id
    LIMIT $${values.length - 1} OFFSET $${values.length}`, values);

  const total = Number(rows[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, team, year, alerts: alertsF, minMaps, maxMaps, minForm, maxForm, minAcs, sort })) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
    }
    regions.forEach((r) => qs.append('region', r));
    roles.forEach((r) => qs.append('role', r));
    qs.set('page', String(p));
    return `/players?${qs}`;
  };
  const active = [q, team, year, alertsF, minMaps, maxMaps, minForm, maxForm, minAcs].filter((v) => v !== '' && v !== null).length
    + (regions.length ? 1 : 0) + (roles.length ? 1 : 0);

  return (
    <>
      <h1>Players</h1>
      <div className="sub" style={{ marginBottom: 20 }}>
        {total} players{active ? ` match ${active} filter${active > 1 ? 's' : ''}` : ''}. Filters combine (AND); tick several regions or roles to allow any of them.
        <Info>
          <p><b>Season</b> limits maps, ACS, role, alerts and the form shown to that year (form = the player's last value that season).</p>
          <p><b>Form</b> = running average of vlr.gg rating x 1000 (1000 is average).</p>
          <p><b>ACS</b> = average combat score per map. <b>maps</b> = maps played.</p>
          <p>Players with few maps have extreme, unreliable averages. Set <b>Min maps</b> (for example 30) to compare players on a fair footing.</p>
        </Info>
      </div>
      <form className="card section" style={{ marginTop: 0, marginBottom: 16 }}>
        <div className="filter-grid">
          <label className="field">Season
            <select name="year" defaultValue={year ?? ''}>
              <option value="">All seasons</option>
              {YEARS.map((y) => <option key={y} value={y}>{y}{y === 2026 ? ' (partial)' : ''}</option>)}
            </select>
          </label>
          <label className="field">Name<input name="q" placeholder="Search name" defaultValue={q} /></label>
          <label className="field">Team<input name="team" placeholder="Team contains" defaultValue={team} /></label>
          <div className="field">Region
            <div className="checks">{REGIONS.map((r) => (
              <label key={r}><input type="checkbox" name="region" value={r} defaultChecked={regions.includes(r)} />{r}</label>))}</div>
          </div>
          <div className="field">Main role
            <div className="checks">{ROLES.map((r) => (
              <label key={r}><input type="checkbox" name="role" value={r} defaultChecked={roles.includes(r)} />{r}</label>))}</div>
          </div>
          <label className="field">Min maps<input type="number" min="0" name="minMaps" defaultValue={minMaps ?? ''} /></label>
          <label className="field">Max maps<input type="number" min="0" name="maxMaps" defaultValue={maxMaps ?? ''} /></label>
          <label className="field">Min ACS<input type="number" min="0" name="minAcs" defaultValue={minAcs ?? ''} /></label>
          <label className="field">Min form<input type="number" name="minForm" defaultValue={minForm ?? ''} /></label>
          <label className="field">Max form<input type="number" name="maxForm" defaultValue={maxForm ?? ''} /></label>
          <label className="field">Open decline alerts
            <select name="alerts" defaultValue={alertsF}>
              <option value="">Any</option><option value="with">Has open alerts</option><option value="none">No open alerts</option>
            </select>
          </label>
          <label className="field">Sort
            <select name="sort" defaultValue={sort}>
              {Object.entries(SORTS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <div className="filters" style={{ margin: 0 }}>
            <button type="submit">Apply</button>
            <Link href="/players">Reset</Link>
          </div>
        </div>
      </form>
      <div className="card">
        <DataTable rows={rows.map(({ total: _t, player_id, ...r }) => ({ ...r, id: player_id }))}
          columns={['player', 'region', 'team', 'role', 'maps', 'avg_acs', 'form', 'open_alerts']}
          links={{ player: (r) => `/players/${r.id}` }} empty="No players match these filters." />
        <div className="filters" style={{ marginTop: 12 }}>
          {page > 1 && <Link href={link(page - 1)}>Previous</Link>}
          <span className="muted">Page {page} of {pages}</span>
          {page < pages && <Link href={link(page + 1)}>Next</Link>}
        </div>
      </div>
    </>
  );
}
