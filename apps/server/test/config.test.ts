import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig({});
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
  });

  it('lists every invalid variable', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'prod',
        PORT: 'nope',
        LOG_LEVEL: 'loud',
      }),
    ).toThrow(/NODE_ENV[\s\S]*PORT[\s\S]*LOG_LEVEL/);
  });

  it('treats the string false as false', () => {
    expect(
      loadConfig({
        ALLOW_PUBLIC_BIND: 'false',
      }).ALLOW_PUBLIC_BIND,
    ).toBe(false);
  });

  it('rejects a public bind in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0' }),
    ).toThrow(/HOST/);
  });

  it('rejects a public bind when ALLOW_PUBLIC_BIND is the string false', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        ALLOW_PUBLIC_BIND: 'false',
      }),
    ).toThrow(/HOST/);
  });

  it('accepts a public bind when ALLOW_PUBLIC_BIND is true', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      ALLOW_PUBLIC_BIND: 'true',
    });
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.ALLOW_PUBLIC_BIND).toBe(true);
  });

  it('accepts loopback hosts in production', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(loadConfig({ NODE_ENV: 'production', HOST: host }).HOST).toBe(
        host,
      );
    }
  });

  it('allows a public bind outside production', () => {
    expect(loadConfig({ HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
  });
});
