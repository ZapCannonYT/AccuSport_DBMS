// PATCH /api/alerts/<id> { status, note } -> moderator reviews an alert (UPDATE)
import { query } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';
import { qdrant } from '@/lib/qdrant';
import { ALERT_COLLECTION } from '@/lib/sync-qdrant.mjs';

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
    RETURNING alert_id, status, review_note`, [status, session.user.id, note || null, Number(id)]);
  if (!rows.length) return Response.json({ error: 'Alert not found' }, { status: 404 });
  // Best effort: update the alert's payload in Qdrant so "similar alerts" shows the new status.
  // Postgres is the source of truth; if Qdrant is down, the next re-sync fixes it.
  try {
    await qdrant.setPayload(ALERT_COLLECTION, { payload: { status: rows[0].status, review_note: rows[0].review_note }, points: [Number(id)], wait: false });
  } catch { /* ignore */ }
  return Response.json({ alert_id: rows[0].alert_id, status: rows[0].status });
}
