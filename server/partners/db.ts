import pg from 'pg';
export interface DB {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
}
let pool: pg.Pool | undefined;
export function database(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error('Partnership database is not configured');
  return (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 }));
}
export async function transaction<T>(fn: (db: DB) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
