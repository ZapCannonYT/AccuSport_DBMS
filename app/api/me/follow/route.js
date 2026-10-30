// POST /api/me/follow { player_id | null } -> follow a player on your dashboard
import { query } from '@/lib/db';
import { requireRole, forbidden } from '@/lib/auth';

export async function POST(req) {
  const session = await requireRole();
  if (!session) return forbidden();
  const { player_id } = await req.json();
  await query('UPDATE users SET followed_player_id = $1 WHERE user_id = $2',
    [player_id === null ? null : Number(player_id), session.user.id]);
  return Response.json({ ok: true });
}
