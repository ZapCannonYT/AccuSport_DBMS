// GET /api/reports/<name>?year=2025 -> rows of one report view (any logged-in user)
import { query, toNumbers } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';
import { REPORTS, SLOW_REPORTS } from '@/lib/reports';

// Slow novelty reports only change when new maps are imported, so keep the result for 10 minutes.
// The cached promise is shared, so two requests at once run the query only once.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
function cached(key, run) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = run().catch((err) => { cache.delete(key); throw err; });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export async function GET(req, { params }) {
  if (!(await requireRole())) return forbidden();
  const { name } = await params;
  const report = REPORTS[name];
  if (!report) return Response.json({ error: 'Unknown report' }, { status: 404 });

  const conditions = [];
  const values = [];
  const year = new URL(req.url).searchParams.get('year');
  if (report.byYear && year) {
    values.push(Number(year));
    conditions.push(`year = $${values.length}`);
  }
  if (report.where) conditions.push(report.where);

  const sql = `SELECT * FROM ${report.view}`
    + (conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '')
    + (report.order ? ` ORDER BY ${report.order}` : '')
    + (report.limit ? ` LIMIT ${report.limit}` : '');
  const run = async () => toNumbers((await query(sql, values)).rows);
  const rows = SLOW_REPORTS.includes(name) ? await cached(`${name}|${values.join(',')}`, run) : await run();
  return Response.json(rows);
}
