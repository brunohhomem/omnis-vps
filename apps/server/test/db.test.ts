import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openDatabase } from '../src/db/client';
import { runMigrations, type MigrationLogger } from '../src/db/migrate';
import { createTestDb } from './helpers/test-db';

const silentLogger: MigrationLogger = {
  info() {},
  error() {},
};

describe('settings', () => {
  const connections: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
  });

  it('sets, gets and deletes a value', async () => {
    const { sqlite, settings } = await createTestDb();
    connections.push(sqlite);

    expect(settings.get('mode', z.string())).toBeNull();
    settings.set('mode', 'fake');
    expect(settings.get('mode', z.string())).toBe('fake');
    settings.set('mode', 'real');
    expect(settings.get('mode', z.string())).toBe('real');
    settings.delete('mode');
    expect(settings.get('mode', z.string())).toBeNull();
  });

  it('throws when the stored value does not match the schema', async () => {
    const { sqlite, settings } = await createTestDb();
    connections.push(sqlite);
    settings.set('count', { value: 1 });

    expect(() =>
      settings.get('count', z.object({ value: z.string() })),
    ).toThrow();
  });
});

describe('runMigrations', () => {
  const directories: string[] = [];
  const connections: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('applies a new database without a backup, then backs up and prunes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'omnis-migrate-'));
    directories.push(root);
    const migrationsDir = path.join(root, 'drizzle');
    const dataDir = path.join(root, 'data');
    const dbFilePath = path.join(dataDir, 'omnis.db');
    const backupDir = path.join(dataDir, 'backups');

    writeMigrations(migrationsDir, [
      {
        tag: '0000_init',
        when: 1,
        sql: 'CREATE TABLE example (id integer PRIMARY KEY NOT NULL);',
      },
    ]);

    const opened = openDatabase(dbFilePath);
    connections.push(opened.sqlite);

    await runMigrations({
      sqlite: opened.sqlite,
      db: opened.db,
      dbFilePath,
      migrationsDir,
      keep: 2,
      logger: silentLogger,
    });
    expect(backups(backupDir)).toEqual([]);
    expect(tableExists(opened.sqlite, 'example')).toBe(true);

    writeMigrations(migrationsDir, [
      {
        tag: '0000_init',
        when: 1,
        sql: 'CREATE TABLE example (id integer PRIMARY KEY NOT NULL);',
      },
      {
        tag: '0001_name',
        when: 2,
        sql: 'ALTER TABLE example ADD COLUMN name text;',
      },
    ]);
    await runMigrations({
      sqlite: opened.sqlite,
      db: opened.db,
      dbFilePath,
      migrationsDir,
      keep: 2,
      logger: silentLogger,
    });
    expect(columnExists(opened.sqlite, 'example', 'name')).toBe(true);
    const firstBackup = backups(backupDir);
    expect(firstBackup).toHaveLength(1);

    writeMigrations(migrationsDir, [
      {
        tag: '0000_init',
        when: 1,
        sql: 'CREATE TABLE example (id integer PRIMARY KEY NOT NULL);',
      },
      {
        tag: '0001_name',
        when: 2,
        sql: 'ALTER TABLE example ADD COLUMN name text;',
      },
      {
        tag: '0002_note',
        when: 3,
        sql: 'ALTER TABLE example ADD COLUMN note text;',
      },
    ]);
    await runMigrations({
      sqlite: opened.sqlite,
      db: opened.db,
      dbFilePath,
      migrationsDir,
      keep: 2,
      logger: silentLogger,
    });
    expect(backups(backupDir)).toHaveLength(2);

    writeMigrations(migrationsDir, [
      {
        tag: '0000_init',
        when: 1,
        sql: 'CREATE TABLE example (id integer PRIMARY KEY NOT NULL);',
      },
      {
        tag: '0001_name',
        when: 2,
        sql: 'ALTER TABLE example ADD COLUMN name text;',
      },
      {
        tag: '0002_note',
        when: 3,
        sql: 'ALTER TABLE example ADD COLUMN note text;',
      },
      {
        tag: '0003_flag',
        when: 4,
        sql: 'ALTER TABLE example ADD COLUMN flag integer;',
      },
    ]);
    await runMigrations({
      sqlite: opened.sqlite,
      db: opened.db,
      dbFilePath,
      migrationsDir,
      keep: 2,
      logger: silentLogger,
    });
    const kept = backups(backupDir);
    expect(kept).toHaveLength(2);
    expect(kept).not.toContain(firstBackup[0]);
  });
});

function writeMigrations(
  migrationsDir: string,
  migrations: Array<{ tag: string; when: number; sql: string }>,
): void {
  mkdirSync(path.join(migrationsDir, 'meta'), { recursive: true });
  writeFileSync(
    path.join(migrationsDir, 'meta', '_journal.json'),
    JSON.stringify(
      {
        version: '7',
        dialect: 'sqlite',
        entries: migrations.map((migration, idx) => ({
          idx,
          version: '6',
          when: migration.when,
          tag: migration.tag,
          breakpoints: true,
        })),
      },
      null,
      2,
    ),
  );
  for (const migration of migrations) {
    writeFileSync(
      path.join(migrationsDir, `${migration.tag}.sql`),
      migration.sql,
    );
  }
}

function backups(backupDir: string): string[] {
  try {
    return readdirSync(backupDir)
      .filter((name) => name.startsWith('omnis.db.bak-'))
      .sort();
  } catch {
    return [];
  }
}

function tableExists(sqlite: Database, table: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row !== undefined;
}

function columnExists(
  sqlite: Database,
  table: string,
  column: string,
): boolean {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return columns.some((info) => info.name === column);
}
