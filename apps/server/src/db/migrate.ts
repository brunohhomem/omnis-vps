import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { AppDatabase } from './client';

let backupSequence = 0;

export type MigrationLogger = {
  info: (bindings: Record<string, unknown>, message: string) => void;
  error: (bindings: Record<string, unknown>, message: string) => void;
};

type Journal = {
  entries?: unknown[];
};

export async function runMigrations(options: {
  sqlite: Database;
  db: AppDatabase;
  dbFilePath: string;
  migrationsDir: string;
  keep: number;
  logger: MigrationLogger;
}): Promise<void> {
  const journalCount = readJournalCount(options.migrationsDir);
  const appliedBefore = countApplied(options.sqlite);
  const pending = journalCount - appliedBefore;
  let backupPath: string | undefined;

  if (pending > 0 && appliedBefore > 0 && options.dbFilePath !== ':memory:') {
    backupPath = await backupDatabase(options.sqlite, options.dbFilePath);
    pruneBackups(path.dirname(backupPath), options.keep);
  }

  try {
    migrate(options.db, { migrationsFolder: options.migrationsDir });
  } catch (error) {
    options.logger.error({ err: error, backupPath }, 'migration failed');
    throw error;
  }

  const applied = countApplied(options.sqlite) - appliedBefore;
  options.logger.info(
    backupPath === undefined ? { applied } : { applied, backupPath },
    'migrations applied',
  );
}

function readJournalCount(migrationsDir: string): number {
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`Can't find migrations journal at ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  return journal.entries?.length ?? 0;
}

function countApplied(sqlite: Database): number {
  const table = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get() as { count: number };
  if (table.count === 0) return 0;
  const row = sqlite
    .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
    .get() as { count: number };
  return row.count;
}

async function backupDatabase(
  sqlite: Database,
  dbFilePath: string,
): Promise<string> {
  const backupDir = path.join(path.dirname(dbFilePath), 'backups');
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const stamp = `${Date.now()}-${String(backupSequence).padStart(4, '0')}`;
  backupSequence += 1;
  const destination = path.join(backupDir, `omnis.db.bak-${stamp}`);

  await sqlite.backup(destination);
  return destination;
}

function pruneBackups(backupDir: string, keep: number): void {
  const backups = readdirSync(backupDir)
    .filter((name) => name.startsWith('omnis.db.bak-'))
    .sort()
    .reverse();

  for (const name of backups.slice(keep)) {
    unlinkSync(path.join(backupDir, name));
  }
}
