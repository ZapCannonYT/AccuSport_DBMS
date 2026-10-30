// GET /api/similar/<player_id>?sameRole=1 -> 5 most similar players (Qdrant)
import { qdrant } from '@/lib/qdrant';
import { COLLECTION } from '@/lib/sync-qdrant.mjs';
import { requireRole, forbidden } from '@/lib/auth';

export async function GET(req, { params }) {
  if (!(await requireRole())) return forbidden();
  const { id } = await params;
  const sameRole = new URL(req.url).searchParams.get('sameRole') === '1';
  try {
    const [point] = await qdrant.retrieve(COLLECTION, { ids: [Number(id)], with_vector: true, with_payload: true });
    if (!point) return Response.json({ error: 'No fingerprint yet: run "npm run sync-qdrant".' }, { status: 404 });
    const must = sameRole && point.payload.main_role ? [{ key: 'main_role', match: { value: point.payload.main_role } }] : [];
    const result = await qdrant.query(COLLECTION, {
      query: point.vector,
      filter: { must, must_not: [{ has_id: [point.id] }] },
      limit: 5,
      with_payload: true,
    });
    return Response.json(result.points.map((p) => ({
      player_id: p.payload.player_id, player: p.payload.name, team: p.payload.team,
      region: p.payload.region, main_role: p.payload.main_role, similarity: Number(p.score.toFixed(3)),
    })));
  } catch {
    return Response.json({ error: 'Qdrant is not running. Start tools/qdrant/qdrant.exe.' }, { status: 503 });
  }
}
