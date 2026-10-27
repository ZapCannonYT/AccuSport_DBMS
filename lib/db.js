// Postgres connection pool for the web app (server side only).
// Next.js loads DATABASE_URL from .env.local automatically.
import pg from 'pg';

// Reuse one pool across hot reloads in development
const globalForPg = globalThis;
export const pool = globalForPg.accusportsPool ?? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== 'production') globalForPg.accusportsPool = pool;

export async function query(text, params) {
  return pool.query(text, params);
}

// Postgres returns NUMERIC and COUNT as strings; convert them for charts and JSON
export function toNumbers(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) =>
    [k, typeof v === 'string' && v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])));
}
