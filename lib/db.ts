import { Pool } from "pg";

/** Neon Postgres. Services use query(); nothing else opens connections. */

let pool: Pool | undefined;

export function db(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL must be set");
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await db().query(text, params);
  return result.rows as T[];
}
