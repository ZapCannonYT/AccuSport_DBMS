// GET /api/alerts/<alert_id>/similar?reviewedOnly=1 -> the 5 most similar past decline alerts (Qdrant),
// from other players, with how they were reviewed and whether a real form drop followed. (moderator, admin)
import { qdrant } from '@/lib/qdrant';
import { ALERT_COLLECTION } from '@/lib/sync-qdrant.mjs';
import { requireRole, forbidden } from '@/lib/auth';

export async function GET(req, { params }) {
  if (!(await requireRole('moderator', 'admin'))) return forbidden();
  const { id } = await params;
  const reviewedOnly = new URL(req.url).searchParams.get('reviewedOnly') === '1';
  try {
    const [point] = await qdrant.retrieve(ALERT_COLLECTION, { ids: [Number(id)], with_vector: true, with_payload: true });
    if (!point) return Response.json({ error: 'This alert is not in Qdrant (only decline alerts are). Re-sync on the Admin page.' }, { status: 404 });
    const must_not = [{ key: 'player_id', match: { value: point.payload.player_id } }];     // other players only
    if (reviewedOnly) must_not.push({ key: 'status', match: { value: 'open' } });
    const result = await qdrant.query(ALERT_COLLECTION, { query: point.vector, filter: { must_not }, limit: 5, with_payload: true });
    const rows = result.points.map((p) => ({
      player_id: p.payload.player_id, player: p.payload.player, metric: p.payload.metric, similarity: Number(p.score.toFixed(3)),
      status: p.payload.status, review_note: p.payload.review_note, form_dropped_after: p.payload.followed_by_form_drop,
      context: p.payload.context,
    }));
    return Response.json({ followed: rows.filter((r) => r.form_dropped_after).length, total: rows.length, rows });
  } catch {
    return Response.json({ error: 'Qdrant is not running. Start tools/qdrant/qdrant.exe.' }, { status: 503 });
  }
}
