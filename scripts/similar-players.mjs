// "Who plays like this pro?" Vector similarity search in Qdrant, joined back to Postgres.
// Usage:
//   npm run similar -- aspas                  all players
//   npm run similar -- aspas --same-role      only players whose main role matches
//   npm run similar -- aspas --same-region    only players from the same region
import { connectPostgres, connectQdrant, COLLECTION, CATEGORIES } from './clients.mjs';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
if (!name) {
  console.log('Usage: npm run similar -- <player name> [--same-role] [--same-region]');
  process.exit(1);
}

const pgClient = await connectPostgres();
const qdrant = connectQdrant();
try {
  // 1. Look up the player in Postgres
  const { rows: [me] } = await pgClient.query(
    `SELECT player_id, name FROM players WHERE lower(name) = lower($1) ORDER BY player_id LIMIT 1`, [name]);
  if (!me) throw new Error(`No player named "${name}"`);

  // 2. Fetch their fingerprint from Qdrant
  const [point] = await qdrant.retrieve(COLLECTION, { ids: [me.player_id], with_vector: true, with_payload: true });
  if (!point) throw new Error('No fingerprint in Qdrant yet. Run: npm run sync-qdrant');
  console.log(`\n${me.name} (${point.payload.team}, ${point.payload.region}, main role: ${point.payload.main_role})`);
  console.table([Object.fromEntries(CATEGORIES.map((c, i) => [c, point.vector[i]]))]);

  // 3. Nearest neighbours by cosine similarity, with optional payload filters
  const must = [];
  if (args.includes('--same-role')) must.push({ key: 'main_role', match: { value: point.payload.main_role } });
  if (args.includes('--same-region')) must.push({ key: 'region', match: { value: point.payload.region } });
  const result = await qdrant.query(COLLECTION, {
    query: point.vector,
    filter: { must, must_not: [{ has_id: [point.id] }] },
    limit: 5,
    with_payload: true,
  });

  // 4. Join back to Postgres for live data (maps played, open alerts)
  const ids = result.points.map((p) => p.payload.player_id);
  const { rows: extra } = await pgClient.query(
    `SELECT p.player_id,
            (SELECT COUNT(*) FROM map_participants pa WHERE pa.player_id = p.player_id)::INT AS maps,
            (SELECT COUNT(*) FROM drift_alerts a WHERE a.player_id = p.player_id
               AND a.direction = 'decline' AND a.status = 'open')::INT AS open_decline_alerts
     FROM players p WHERE p.player_id = ANY($1)`, [ids]);
  const lookup = new Map(extra.map((r) => [r.player_id, r]));

  console.log(`Players who play most like ${me.name}:`);
  console.table(result.points.map((p) => ({
    player: p.payload.name,
    team: p.payload.team,
    region: p.payload.region,
    main_role: p.payload.main_role,
    similarity: Number(p.score.toFixed(3)),
    maps: lookup.get(p.payload.player_id)?.maps,
    open_decline_alerts: lookup.get(p.payload.player_id)?.open_decline_alerts,
  })));
} finally {
  await pgClient.end();
}
