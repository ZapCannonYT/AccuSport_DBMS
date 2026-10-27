// Creates the schema, CUSUM logic and report views, loads the metric definitions
// and app accounts, then imports the real Valorant VCT data from data/vct/.
// Usage: npm run setup-db   (reads DATABASE_URL from .env.local)
// WARNING: 01_schema.sql drops and recreates all tables.
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import dotenv from 'dotenv';
import { seed } from './seed.mjs';
import { importVct } from './import-vct.mjs';

dotenv.config({ path: '.env.local' });
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

// Connect; if the database itself does not exist yet (local install), create it first
async function connect() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    return client;
  } catch (err) {
    if (err.code !== '3D000') throw err;         // 3D000 = database does not exist
    const url = new URL(process.env.DATABASE_URL);
    const dbName = url.pathname.slice(1);
    url.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    console.log(`Creating database "${dbName}"`);
    await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
    await admin.end();
    const retry = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await retry.connect();
    return retry;
  }
}

const client = await connect();
try {
  for (const file of ['01_schema.sql', '02_cusum.sql', '03_reports.sql']) {
    console.log(`Running db/${file}`);
    await client.query(await readFile(new URL(`../db/${file}`, import.meta.url), 'utf8'));
  }
  const query = (text, params) => client.query(text, params);
  console.log('Seeding metric definitions and app accounts...');
  await seed(query);
  console.log('Importing real Valorant VCT data (takes about a minute)...');
  await importVct(query);
  const { rows } = await client.query(
    `SELECT direction, COUNT(*)::int AS alerts FROM drift_alerts GROUP BY direction`);
  console.log('Alerts raised:', rows);
} finally {
  await client.end();
}
