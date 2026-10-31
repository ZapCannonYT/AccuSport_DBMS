// GET /api/similar/<player_id>?sameRole=1&sameRegion=1&otherTeams=1&minMaps=30 -> 5 most similar players (Qdrant)
// The vector is the 36-number profile (see lib/sync-qdrant.mjs); the rest are payload filters on the search.
import { qdrant } from '@/lib/qdrant';
import { COLLECTION } from '@/lib/sync-qdrant.mjs';
import { requireRole, forbidden } from '@/lib/auth';

export async function GET(req, { params }) {
  if (!(await requireRole())) return forbidden();
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const minMaps = Number(sp.get('minMaps'));
  try {
    const [point] = await qdrant.retrieve(COLLECTION, { ids: [Number(id)], with_vector: true, with_payload: true });
    if (!point) return Response.json({ error: 'No profile yet: run "npm run sync-qdrant".' }, { status: 404 });
    const must = [];
    const must_not = [{ has_id: [point.id] }];
    if (sp.get('sameRole') === '1' && point.payload.main_role) must.push({ key: 'main_role', match: { value: point.payload.main_role } });
    if (sp.get('sameRegion') === '1' && point.payload.region) must.push({ key: 'region', match: { value: point.payload.region } });
    if (sp.get('otherTeams') === '1' && point.payload.team) must_not.push({ key: 'team', match: { value: point.payload.team } });
    if (Number.isFinite(minMaps) && minMaps > 0) must.push({ key: 'maps', range: { gte: minMaps } });
    const result = await qdrant.query(COLLECTION, { query: point.vector, filter: { must, must_not }, limit: 5, with_payload: true });
    return Response.json(result.points.map((p) => ({
      player_id: p.payload.player_id, player: p.payload.name, team: p.payload.team, region: p.payload.region,
      main_role: p.payload.main_role, maps: p.payload.maps, similarity: Number(p.score.toFixed(3)),
    })));
  } catch {
    return Response.json({ error: 'Qdrant is not running. Start tools/qdrant/qdrant.exe.' }, { status: 503 });
  }
}
