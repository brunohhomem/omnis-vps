import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import pino, { type LoggerOptions } from 'pino';
import { createSettingsService, type SettingsService } from './core/settings';
import type { Config } from './config';
import { openDatabase, type AppDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { createAdapters, type Adapters } from './infra';
import {
  createAuditService,
  type AuditService,
} from './modules/audit/audit.service';
import {
  createAuthService,
  type AuthService,
} from './modules/auth/auth.service';

export type AppDeps = {
  config: Config;
  logger: FastifyBaseLogger;
  db: AppDatabase;
  settings: SettingsService;
  adapters: Adapters;
  audit: AuditService;
  auth: AuthService;
};

export async function createDeps(config: Config): Promise<AppDeps> {
  const logger = createLogger(config);
  const dbFilePath = path.join(config.DATA_DIR, 'omnis.db');
  const opened = openDatabase(dbFilePath);
  try {
    await runMigrations({
      sqlite: opened.sqlite,
      db: opened.db,
      dbFilePath,
      migrationsDir: config.MIGRATIONS_DIR,
      keep: config.DB_BACKUPS_KEEP,
      logger,
    });
    const adapters = createAdapters(config, logger);
    const audit = createAuditService({ db: opened.db, logger });
    audit.reconcileInterrupted();
    const auth = createAuthService({ db: opened.db, config });
    return {
      config,
      logger,
      db: opened.db,
      settings: createSettingsService({ db: opened.db }),
      adapters,
      audit,
      auth,
    };
  } catch (error) {
    opened.sqlite.close();
    throw error;
  }
}

function createLogger(config: Config): FastifyBaseLogger {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  };

  if (config.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    };
  }

  return pino(options);
}
