// Command-line rebuild of the Qdrant collection from Postgres.
// Usage: npm run sync-qdrant   (Qdrant must be running)
import { connectPostgres, connectQdrant } from './clients.mjs';
import { syncQdrant, COLLECTION } from '../lib/sync-qdrant.mjs';

const pgClient = await connectPostgres();
try {
  const { synced, count } = await syncQdrant((t, p) => pgClient.query(t, p), connectQdrant());
  console.log(`Synced ${synced} fingerprints from Postgres; Qdrant collection "${COLLECTION}" now has ${count} points.`);
} finally {
  await pgClient.end();
}
