// Shared database clients for the scripts. Config comes from .env.local only.
import pg from 'pg';
import dotenv from 'dotenv';
import { QdrantClient } from '@qdrant/js-client-rest';

dotenv.config({ path: '.env.local' });

export const COLLECTION = 'playstyle';
export const CATEGORIES = ['fragging', 'survival', 'damage', 'precision'];   // vector order

export async function connectPostgres() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

export function connectQdrant() {
  return new QdrantClient({
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY || undefined,
  });
}
