import path from 'node:path';
import {
  createSettingsService,
  type SettingsService,
} from '../../src/core/settings';
import { openDatabase, type AppDatabase } from '../../src/db/client';
import { runMigrations, type MigrationLogger } from '../../src/db/migrate';
import type { Database } from 'better-sqlite3';

const silentLogger: MigrationLogger = {
  info() {},
  error() {},
};

export async function createTestDb(): Promise<{
  sqlite: Database;
  db: AppDatabase;
  settings: SettingsService;
}> {
  const opened = openDatabase(':memory:');
  await runMigrations({
    sqlite: opened.sqlite,
    db: opened.db,
    dbFilePath: ':memory:',
    migrationsDir: path.resolve(process.cwd(), 'drizzle'),
    keep: 5,
    logger: silentLogger,
  });
  return {
    sqlite: opened.sqlite,
    db: opened.db,
    settings: createSettingsService({ db: opened.db }),
  };
}
