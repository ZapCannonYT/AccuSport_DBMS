// POST /api/admin/maintenance { action: 'sync-qdrant' | 'refresh-leaderboard' }
import { query } from '@/lib/db';
import { qdrant } from '@/lib/qdrant';
import { syncQdrant } from '@/lib/sync-qdrant.mjs';
import { requireRole, forbidden } from '@/lib/auth';

export async function POST(req) {
  if (!(await requireRole('admin'))) return forbidden();
  const { action } = await req.json();
  if (action === 'refresh-leaderboard') {
    await query('REFRESH MATERIALIZED VIEW mv_leaderboard');
    return Response.json({ message: 'Leaderboard refreshed.' });
  }
  if (action === 'sync-qdrant') {
    try {
      const { players, alerts } = await syncQdrant(query, qdrant);
      return Response.json({ message: `Synced ${players.synced} player profiles and ${alerts.synced} decline alerts into Qdrant.` });
    } catch {
      return Response.json({ error: 'Qdrant is not running. Start tools/qdrant/qdrant.exe.' }, { status: 503 });
    }
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
