// Player list with search, filters and pagination (all done in SQL)
import Link from 'next/link';
import { query } from '@/lib/db';
import DataTable from '@/components/DataTable';

export const dynamic = 'force-dynamic';
const PAGE_SIZE = 25;
const SORTS = { form: 'c.form DESC NULLS LAST', maps: 'maps DESC', alerts: 'open_alerts DESC, c.form DESC', name: 'lower(p.name)' };

export default async function PlayersPage({ searchParams }) {
  const sp = await searchParams;
  const q = sp.q || '', region = sp.region || '', sort = SORTS[sp.sort] ? sp.sort : 'form';
  const page = Math.max(1, Number(sp.page) || 1);

  const values = [];
  const where = [];
  if (q) { values.push(`%${q}%`); where.push(`p.name ILIKE $${values.length}`); }
  if (region) { values.push(region); where.push(`p.region = $${values.length}`); }
  values.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);

  const { rows } = await query(`
    SELECT p.player_id, p.name AS player, p.region, c.team, c.form,
           (SELECT COUNT(*) FROM map_participants pa WHERE pa.player_id = p.player_id)::INT AS maps,
           (SELECT COUNT(*) FROM drift_alerts a WHERE a.player_id = p.player_id
              AND a.direction = 'decline' AND a.status = 'open')::INT AS open_alerts,
           COUNT(*) OVER () AS total
    FROM players p
    LEFT JOIN v_player_current c ON c.player_id = p.player_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${SORTS[sort]}
    LIMIT $${values.length - 1} OFFSET $${values.length}`, values);

  const total = Number(rows[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p) => `/players?${new URLSearchParams({ q, region, sort, page: String(p) })}`;

  return (
    <>
      <h1>Players</h1>
      <p className="sub">{total} players. Form = running average of vlr.gg rating x 1000 (1000 is average).</p>
      <form className="filters">
        <input name="q" placeholder="Search name" defaultValue={q} />
        <select name="region" defaultValue={region}>
          <option value="">All regions</option>
          {['AMER', 'EMEA', 'PAC', 'CN'].map((r) => <option key={r}>{r}</option>)}
        </select>
        <select name="sort" defaultValue={sort}>
          <option value="form">Best form</option>
          <option value="maps">Most maps</option>
          <option value="alerts">Most open alerts</option>
          <option value="name">Name</option>
        </select>
        <button type="submit">Apply</button>
      </form>
      <div className="card">
        <DataTable rows={rows.map(({ total: _t, player_id, ...r }) => ({ ...r, id: player_id }))}
          columns={['player', 'region', 'team', 'form', 'maps', 'open_alerts']}
          links={{ player: (r) => `/players/${r.id}` }} empty="No players match." />
        <div className="filters" style={{ marginTop: 12 }}>
          {page > 1 && <Link href={link(page - 1)}>Previous</Link>}
          <span className="muted">Page {page} of {pages}</span>
          {page < pages && <Link href={link(page + 1)}>Next</Link>}
        </div>
      </div>
    </>
  );
}
