import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { getClientIp } from '../src/core/client-ip';
import { createDeps, type AppDeps } from '../src/deps';
import { apiTokens, sessions, users } from '../src/db/schema/auth';
import { TEST_SECRET_KEY } from './helpers/secret';

const PASSWORD = 'correct-horse-battery';
const dataDirs: string[] = [];

async function createApp(
  env: NodeJS.ProcessEnv = {},
): Promise<ReturnType<typeof buildApp> & { deps: AppDeps }> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'omnis-auth-'));
  dataDirs.push(dataDir);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    OMNIS_MODE: 'fake',
    OMNIS_SECRET_KEY: TEST_SECRET_KEY,
    ...env,
    DATA_DIR: dataDir,
  });
  const deps = await createDeps(config);
  return Object.assign(buildApp(deps), { deps });
}

async function seedUser(deps: AppDeps, username = 'operator') {
  const secret = new Secret({ size: 20 });
  await deps.auth.setupUser({
    username,
    password: PASSWORD,
    totpSecret: secret.base32,
  });
  return secret;
}

function codeFor(secret: Secret): string {
  return TOTP.generate({ secret });
}

describe('auth', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const dir of dataDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('logs in with a generated TOTP and sets a session cookie', async () => {
    const app = await createApp();
    apps.push(app);
    const secret = await seedUser(app.deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'operator',
        password: PASSWORD,
        totp: codeFor(secret),
      },
    });

    expect(response.statusCode).toBe(204);
    const cookie = response.cookies.find(
      (item) => item.name === 'omnis_session',
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/');

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `omnis_session=${cookie?.value}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({
      username: 'operator',
      authType: 'session',
      scope: 'admin',
    });

    const user = app.deps.db.select().from(users).get();
    expect(user?.passwordHash).not.toBe(PASSWORD);
    expect(user?.passwordHash.startsWith('$argon2')).toBe(true);
    expect(user?.totpSecretEnc).not.toContain(secret.base32);
    const session = app.deps.db.select().from(sessions).get();
    expect(session?.idHash).not.toBe(cookie?.value);
    expect(session?.idHash).toHaveLength(64);
  });

  it('returns the same body for wrong password, wrong TOTP, reuse, and a missing user', async () => {
    const app = await createApp();
    apps.push(app);
    const secret = await seedUser(app.deps);
    const totp = codeFor(secret);
    const expected = {
      error: { code: 'UNAUTHORIZED', message: 'credenciais inválidas' },
    };

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.10',
      payload: { username: 'operator', password: 'not-the-password', totp },
    });
    const wrongTotp = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.11',
      payload: {
        username: 'operator',
        password: PASSWORD,
        totp: totp === '000000' ? '111111' : '000000',
      },
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.12',
      payload: { username: 'nobody', password: PASSWORD, totp },
    });

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.13',
      payload: { username: 'operator', password: PASSWORD, totp },
    });
    const reused = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '203.0.113.14',
      payload: { username: 'operator', password: PASSWORD, totp },
    });

    expect(ok.statusCode).toBe(204);
    for (const response of [wrongPassword, wrongTotp, missing, reused]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(expected);
    }
  });

  it('rate limits the 6th login attempt from the same client IP', async () => {
    const app = await createApp();
    apps.push(app);
    await seedUser(app.deps);

    const attempts = [];
    for (let index = 0; index < 6; index += 1) {
      attempts.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress: '198.51.100.20',
          payload: {
            username: 'operator',
            password: 'not-the-password',
            totp: '123456',
          },
        }),
      );
    }

    expect(
      attempts.slice(0, 5).every((response) => response.statusCode === 401),
    ).toBe(true);
    expect(attempts[5]?.statusCode).toBe(429);
    expect(attempts[5]?.json().error.code).toBe('RATE_LIMITED');
  });

  it('honors cf-connecting-ip only for a trusted loopback connection', () => {
    const header = { 'cf-connecting-ip': '203.0.113.50' };
    expect(
      getClientIp(
        { ip: '127.0.0.1', headers: header },
        { TRUST_CLOUDFLARE: true },
      ),
    ).toBe('203.0.113.50');
    expect(
      getClientIp({ ip: '::1', headers: header }, { TRUST_CLOUDFLARE: true }),
    ).toBe('203.0.113.50');
    expect(
      getClientIp(
        { ip: '127.0.0.1', headers: header },
        { TRUST_CLOUDFLARE: false },
      ),
    ).toBe('127.0.0.1');
    expect(
      getClientIp(
        { ip: '203.0.113.9', headers: header },
        { TRUST_CLOUDFLARE: true },
      ),
    ).toBe('203.0.113.9');
  });

  it('stores the Cloudflare IP on the session when the tunnel is trusted', async () => {
    const app = await createApp({ TRUST_CLOUDFLARE: 'true' });
    apps.push(app);
    const secret = await seedUser(app.deps);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      remoteAddress: '127.0.0.1',
      headers: { 'cf-connecting-ip': '203.0.113.77' },
      payload: {
        username: 'operator',
        password: PASSWORD,
        totp: codeFor(secret),
      },
    });

    expect(response.statusCode).toBe(204);
    expect(app.deps.db.select().from(sessions).get()?.ip).toBe('203.0.113.77');
  });

  it('enforces scope and session-only token management', async () => {
    const app = await createApp();
    apps.push(app);
    const secret = await seedUser(app.deps);
    app.get('/api/ops-probe', { config: { scope: 'ops' } }, async () => ({
      ok: true,
    }));

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'operator',
        password: PASSWORD,
        totp: codeFor(secret),
      },
    });
    const cookie = login.cookies.find((item) => item.name === 'omnis_session');
    const session = { cookie: `omnis_session=${cookie?.value}` };

    const read = await app.inject({
      method: 'POST',
      url: '/api/auth/tokens',
      headers: session,
      payload: { name: 'reader', scope: 'read' },
    });
    const ops = await app.inject({
      method: 'POST',
      url: '/api/auth/tokens',
      headers: session,
      payload: { name: 'operator-token', scope: 'ops' },
    });
    expect(read.statusCode).toBe(200);
    expect(ops.statusCode).toBe(200);
    const readToken = read.json().token as string;
    const opsToken = ops.json().token as string;
    expect(readToken).toMatch(/^omn_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{32}$/);
    expect(read.json()).not.toHaveProperty('tokenHash');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/auth/tokens',
      headers: session,
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.stringify(listed.json())).not.toContain(readToken);

    const stored = app.deps.db.select().from(apiTokens).all();
    expect(stored.every((row) => row.tokenHash !== readToken)).toBe(true);

    const readProbe = await app.inject({
      method: 'GET',
      url: '/api/ops-probe',
      headers: { authorization: `Bearer ${readToken}` },
    });
    const opsProbe = await app.inject({
      method: 'GET',
      url: '/api/ops-probe',
      headers: { authorization: `Bearer ${opsToken}` },
    });
    const sessionProbe = await app.inject({
      method: 'GET',
      url: '/api/ops-probe',
      headers: session,
    });
    expect(readProbe.statusCode).toBe(403);
    expect(opsProbe.statusCode).toBe(200);
    expect(sessionProbe.statusCode).toBe(200);

    const tokenCreate = await app.inject({
      method: 'POST',
      url: '/api/auth/tokens',
      headers: { authorization: `Bearer ${opsToken}` },
      payload: { name: 'nope', scope: 'read' },
    });
    expect(tokenCreate.statusCode).toBe(403);
    expect(tokenCreate.json().error.message).toBe('Session required');

    const info = await app.inject({
      method: 'GET',
      url: '/api/system/info',
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(info.statusCode).toBe(200);

    const id = read.json().id as number;
    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/auth/tokens/${id}`,
      headers: session,
    });
    expect(revoked.statusCode).toBe(204);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: '/api/system/info',
      headers: { authorization: `Bearer ${readToken}` },
    });
    expect(afterRevoke.statusCode).toBe(401);

    const expired = await app.deps.auth.createToken({
      name: 'expired',
      scope: 'read',
      expiresInDays: 1,
    });
    app.deps.db
      .update(apiTokens)
      .set({ expiresAt: Date.now() - 1_000 })
      .where(eq(apiTokens.id, expired.id))
      .run();
    const afterExpiry = await app.inject({
      method: 'GET',
      url: '/api/system/info',
      headers: { authorization: `Bearer ${expired.token}` },
    });
    expect(afterExpiry.statusCode).toBe(401);
  });

  it('rejects protected routes without a credential and keeps the allowlist open', async () => {
    const app = await createApp();
    apps.push(app);

    const info = await app.inject({ method: 'GET', url: '/api/system/info' });
    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/system/snapshot',
    });
    const audit = await app.inject({ method: 'GET', url: '/api/audit' });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });

    for (const response of [info, snapshot, audit, me]) {
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
    expect(health.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(404);
  });
});
