// PATCH /api/alerts/<id> { status, note } -> moderator reviews an alert (UPDATE)
import { query } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function PATCH(req, { params }) {
  const session = await requireRole('moderator', 'admin');
  if (!session) return forbidden();
  const { id } = await params;
  const { status, note } = await req.json();
  if (!['open', 'acknowledged', 'resolved'].includes(status)) {
    return Response.json({ error: 'Invalid status' }, { status: 400 });
  }
  const { rows } = await query(`
    UPDATE drift_alerts
    SET status = $1::VARCHAR,
        reviewed_by = $2,
        review_note = COALESCE($3, review_note),
        resolved_at = CASE WHEN $1::VARCHAR = 'resolved' THEN now() ELSE NULL END
    WHERE alert_id = $4
    RETURNING alert_id, status`, [status, session.user.id, note || null, Number(id)]);
  if (!rows.length) return Response.json({ error: 'Alert not found' }, { status: 404 });
  return Response.json(rows[0]);
}
