// GET /api/reports/<name>?year=2025 -> rows of one report view (any logged-in user)
import { query, toNumbers } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';
import { REPORTS } from '@/lib/reports';

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
  const { rows } = await query(sql, values);
  return Response.json(toNumbers(rows));
}
