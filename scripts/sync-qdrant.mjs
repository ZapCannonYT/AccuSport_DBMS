// Command-line rebuild of the Qdrant collections from Postgres.
// Usage: npm run sync-qdrant   (Qdrant must be running)
import { connectPostgres, connectQdrant } from './clients.mjs';
import { syncQdrant, COLLECTION, ALERT_COLLECTION } from '../lib/sync-qdrant.mjs';

const pgClient = await connectPostgres();
try {
  const { players, alerts } = await syncQdrant((t, p) => pgClient.query(t, p), connectQdrant());
  console.log(`Synced ${players.synced} player profiles (${players.dimensions} numbers each); "${COLLECTION}" now has ${players.count} points.`);
  console.log(`Synced ${alerts.synced} decline alerts (${alerts.dimensions} numbers each); "${ALERT_COLLECTION}" now has ${alerts.count} points.`);
} finally {
  await pgClient.end();
}
