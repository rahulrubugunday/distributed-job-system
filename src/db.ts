import 'dotenv/config';
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});