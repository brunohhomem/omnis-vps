import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { TEST_SECRET_KEY } from './helpers/secret';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { OMNIS_SECRET_KEY: TEST_SECRET_KEY, ...overrides };
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(env());
    expect(config.NODE_ENV).toBe('development');
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.ALLOW_PUBLIC_BIND).toBe(false);
    expect(config.PORT).toBe(4010);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.OMNIS_MODE).toBe('real');
    expect(config.WEB_DIST_DIR).toBeUndefined();
    expect(config.DATA_DIR).toBe(path.resolve(process.cwd(), 'data'));
    expect(config.MIGRATIONS_DIR).toBe(path.resolve(process.cwd(), 'drizzle'));
    expect(config.DB_BACKUPS_KEEP).toBe(5);
    expect(config.DISK_MOUNTS).toEqual(['/']);
    expect(config.OMNIS_SECRET_KEY).toBe(TEST_SECRET_KEY);
    expect(config.SESSION_TTL_HOURS).toBe(168);
    expect(config.COOKIE_SECURE).toBe(true);
    expect(config.TRUST_CLOUDFLARE).toBe(false);
    expect(config.MCP_ALLOWED_ORIGINS).toEqual([]);
  });

  it('splits DISK_MOUNTS and drops empty entries', () => {
    expect(loadConfig(env({ DISK_MOUNTS: '/, /var' })).DISK_MOUNTS).toEqual([
      '/',
      '/var',
    ]);
  });

  it('rejects a DISK_MOUNTS value with no mounts', () => {
    expect(() => loadConfig(env({ DISK_MOUNTS: ' , ' }))).toThrow(
      /DISK_MOUNTS/,
    );
  });

  it('lists every invalid variable', () => {
    expect(() =>
      loadConfig(
        env({
          NODE_ENV: 'prod',
          PORT: 'nope',
          LOG_LEVEL: 'loud',
        }),
      ),
    ).toThrow(/NODE_ENV[\s\S]*PORT[\s\S]*LOG_LEVEL/);
  });

  it('treats the string false as false', () => {
    expect(
      loadConfig(
        env({
          ALLOW_PUBLIC_BIND: 'false',
        }),
      ).ALLOW_PUBLIC_BIND,
    ).toBe(false);
  });

  it('rejects a public bind in production', () => {
    expect(() =>
      loadConfig(env({ NODE_ENV: 'production', HOST: '0.0.0.0' })),
    ).toThrow(/HOST/);
  });

  it('rejects a public bind when ALLOW_PUBLIC_BIND is the string false', () => {
    expect(() =>
      loadConfig(
        env({
          NODE_ENV: 'production',
          HOST: '0.0.0.0',
          ALLOW_PUBLIC_BIND: 'false',
        }),
      ),
    ).toThrow(/HOST/);
  });

  it('accepts a public bind when ALLOW_PUBLIC_BIND is true', () => {
    const config = loadConfig(
      env({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        ALLOW_PUBLIC_BIND: 'true',
      }),
    );
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.ALLOW_PUBLIC_BIND).toBe(true);
  });

  it('accepts loopback hosts in production', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(loadConfig(env({ NODE_ENV: 'production', HOST: host })).HOST).toBe(
        host,
      );
    }
  });

  it('allows a public bind outside production', () => {
    expect(loadConfig(env({ HOST: '0.0.0.0' })).HOST).toBe('0.0.0.0');
  });

  it('rejects a secret key that is not 32 bytes', () => {
    expect(() => loadConfig(env({ OMNIS_SECRET_KEY: 'aa' }))).toThrow(
      /OMNIS_SECRET_KEY/,
    );
  });
});
