import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ApiErrorSchema,
  HealthOutputSchema,
  SystemInfoOutputSchema,
} from '@omnis/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { AppError } from '../src/core/errors';
import { createDeps } from '../src/deps';
import { version } from '../src/version';

const dataDirs: string[] = [];

async function createApp(env: NodeJS.ProcessEnv = {}) {
  const dataDir =
    env.DATA_DIR ?? mkdtempSync(path.join(tmpdir(), 'omnis-data-'));
  if (env.DATA_DIR === undefined) dataDirs.push(dataDir);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    ...env,
    DATA_DIR: dataDir,
  });
  const deps = await createDeps(config);
  return buildApp(deps);
}

describe('http', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const dir of dataDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('GET /api/health matches HealthOutputSchema', async () => {
    const app = await createApp();
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = HealthOutputSchema.parse(response.json());
    expect(body.status).toBe('ok');
    expect(body.version).toBe(version);
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(body.rssBytes).toBeGreaterThan(0);
  });

  it('GET /api/system/info matches SystemInfoOutputSchema', async () => {
    const app = await createApp({ OMNIS_MODE: 'fake' });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/system/info',
    });

    expect(response.statusCode).toBe(200);
    const body = SystemInfoOutputSchema.parse(response.json());
    expect(body.omnisVersion).toBe(version);
    expect(body.mode).toBe('fake');
    expect(body.nodeVersion).toBe(process.version);
  });

  it('returns ApiErrorSchema for an unknown route', async () => {
    const app = await createApp();
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns VALIDATION_ERROR for an invalid body', async () => {
    const app = await createApp();
    apps.push(app);
    app.post(
      '/api/widgets',
      {
        schema: {
          body: z.object({
            name: z.string(),
          }),
        },
      },
      async () => ({ ok: true }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/widgets',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    const body = ApiErrorSchema.parse(response.json());
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
  });

  it('uses the AppError status and code', async () => {
    const app = await createApp();
    apps.push(app);
    app.get('/api/conflict', async () => {
      throw new AppError('CONFLICT', 'already exists', 409, { id: '1' });
    });

    const response = await app.inject({ method: 'GET', url: '/api/conflict' });

    expect(response.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(response.json())).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'already exists',
        details: { id: '1' },
      },
    });
  });

  it('hides unexpected error details in production', async () => {
    const app = await createApp({ NODE_ENV: 'production' });
    apps.push(app);
    app.get('/api/explode', async () => {
      throw new Error('boom-detail');
    });

    const response = await app.inject({ method: 'GET', url: '/api/explode' });
    const body = ApiErrorSchema.parse(response.json());

    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(response.body).not.toContain('boom-detail');
    expect(response.body).not.toContain('stack');
  });

  it('serves the static export without capturing /api', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'omnis-web-'));
    tempDirs.push(root);
    writeFileSync(path.join(root, 'index.html'), '<html>home</html>');
    writeFileSync(path.join(root, '404.html'), '<html>missing</html>');

    const app = await createApp({ WEB_DIST_DIR: root });
    apps.push(app);

    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('home');

    const missing = await app.inject({ method: 'GET', url: '/missing-page' });
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain('missing');

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.statusCode).toBe(200);
    expect(HealthOutputSchema.parse(health.json()).status).toBe('ok');

    const apiMissing = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });
    expect(apiMissing.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(apiMissing.json()).error.code).toBe(
      'NOT_FOUND',
    );
  });
});
