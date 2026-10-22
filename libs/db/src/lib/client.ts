import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
  ping: () => Promise<boolean>;
}

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const sql = postgres(url, { max: opts.max ?? 10, onnotice: () => undefined });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return {
    db,
    close: () => sql.end({ timeout: 5 }),
    ping: async () => {
      try {
        await sql`select 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await sql.end();
  }
}
