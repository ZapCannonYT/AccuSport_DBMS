// PATCH /api/admin/metrics/<id> { label?, monitored? } -> edit a metric definition (UPDATE)
// monitored = false stops CUSUM watching the metric for new data; values are still stored.
import { query } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function PATCH(req, { params }) {
  if (!(await requireRole('admin'))) return forbidden();
  const { id } = await params;
  const { label, monitored } = await req.json();
  const { rows } = await query(`
    UPDATE metric_definitions
    SET label = COALESCE($1, label), monitored = COALESCE($2, monitored)
    WHERE metric_id = $3
    RETURNING metric_id, label, monitored`, [label || null, typeof monitored === 'boolean' ? monitored : null, Number(id)]);
  return rows.length ? Response.json(rows[0]) : Response.json({ error: 'Not found' }, { status: 404 });
}
