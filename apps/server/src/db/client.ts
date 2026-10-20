import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  drizzle,
  type BetterSQLite3Database,
} from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type AppDatabase = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

export function openDatabase(filePath: string): {
  sqlite: Database.Database;
  db: AppDatabase;
} {
  if (filePath !== ':memory:') {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }

  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}
