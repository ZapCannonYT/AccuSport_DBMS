// DELETE /api/admin/users/<id> -> remove an app account (not yourself)
import { query } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function DELETE(req, { params }) {
  const session = await requireRole('admin');
  if (!session) return forbidden();
  const { id } = await params;
  if (Number(id) === session.user.id) {
    return Response.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }
  // drift_alerts.reviewed_by is ON DELETE SET NULL, so reviews stay but lose the reviewer
  const { rowCount } = await query('DELETE FROM users WHERE user_id = $1', [Number(id)]);
  return rowCount ? Response.json({ ok: true }) : Response.json({ error: 'Not found' }, { status: 404 });
}
