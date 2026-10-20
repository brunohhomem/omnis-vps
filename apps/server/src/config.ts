import path from 'node:path';
import { OmnisModeSchema } from '@omnis/shared';
import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const PinoLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

function emptyToUndefined(value: unknown): unknown {
  if (value === '') return undefined;
  return value;
}

// z.coerce.boolean() treats every non-empty string, including "false", as true.
const EnvBooleanSchema = z.preprocess((value: unknown) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}, z.boolean());

export const ConfigSchema = z
  .object({
    NODE_ENV: z.preprocess(
      emptyToUndefined,
      z.enum(['development', 'production', 'test']).default('development'),
    ),
    HOST: z.preprocess(
      emptyToUndefined,
      z.string().min(1).default('127.0.0.1'),
    ),
    ALLOW_PUBLIC_BIND: EnvBooleanSchema.default(false),
    PORT: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(65535).default(4010),
    ),
    LOG_LEVEL: z.preprocess(emptyToUndefined, PinoLevelSchema.default('info')),
    OMNIS_MODE: z.preprocess(emptyToUndefined, OmnisModeSchema.default('real')),
    WEB_DIST_DIR: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    DATA_DIR: z
      .preprocess(emptyToUndefined, z.string().min(1).default('./data'))
      .transform((value) => path.resolve(process.cwd(), value)),
    MIGRATIONS_DIR: z
      .preprocess(emptyToUndefined, z.string().min(1).default('./drizzle'))
      .transform((value) => path.resolve(process.cwd(), value)),
    DB_BACKUPS_KEEP: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).default(5),
    ),
    DISK_MOUNTS: z
      .preprocess(emptyToUndefined, z.string().min(1).default('/'))
      .transform((value) =>
        value
          .split(',')
          .map((mount) => mount.trim())
          .filter((mount) => mount.length > 0),
      ),
    OMNIS_SECRET_KEY: z.string().min(1),
    SESSION_TTL_HOURS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).default(168),
    ),
    COOKIE_SECURE: EnvBooleanSchema.default(true),
    TRUST_CLOUDFLARE: EnvBooleanSchema.default(false),
    MCP_ALLOWED_ORIGINS: z
      .preprocess(emptyToUndefined, z.string().optional())
      .transform((value) => {
        if (value === undefined) return [];
        return value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);
      }),
  })
  .superRefine((config, ctx) => {
    if (Buffer.from(config.OMNIS_SECRET_KEY, 'base64').length !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['OMNIS_SECRET_KEY'],
        message: 'OMNIS_SECRET_KEY must be 32 bytes in base64',
      });
    }
    if (config.DISK_MOUNTS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['DISK_MOUNTS'],
        message: 'DISK_MOUNTS must list at least one mount',
      });
    }
    if (config.NODE_ENV !== 'production' || config.ALLOW_PUBLIC_BIND) return;
    if (LOOPBACK_HOSTS.has(config.HOST)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['HOST'],
      message:
        'HOST must be loopback (127.0.0.1, ::1, localhost) in production unless ALLOW_PUBLIC_BIND=true',
    });
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
