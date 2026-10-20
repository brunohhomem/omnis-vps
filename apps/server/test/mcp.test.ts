import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConfirmSchema } from '@omnis/shared';
import { Client } from '@modelcontextprotocol/sdk/client';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Secret, TOTP } from 'otpauth';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import type { ToolDef } from '../src/core/tool';
import { createDeps } from '../src/deps';
import { validateTools } from '../src/modules/mcp/registry';
import { TEST_SECRET_KEY } from './helpers/secret';

const dataDirs: string[] = [];

async function createApp(env: NodeJS.ProcessEnv = {}, tools?: ToolDef[]) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'omnis-mcp-'));
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
  return Object.assign(buildApp(deps, { tools }), { deps });
}

function tool(overrides: Partial<ToolDef> & Pick<ToolDef, 'name'>): ToolDef {
  return {
    description: 'Test tool.',
    scope: 'read',
    destructive: false,
    input: z.object({}),
    handler: async () => ({ ok: true }),
    ...overrides,
  };
}

describe('mcp registry', () => {
  afterEach(() => {
    for (const dir of dataDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate names', () => {
    expect(() =>
      validateTools([
        tool({ name: 'system_info' }),
        tool({ name: 'system_info' }),
      ]),
    ).toThrow(/Duplicate MCP tool name: system_info/);
  });

  it('rejects a name outside the pattern', () => {
    expect(() => validateTools([tool({ name: 'SystemInfo' })])).toThrow(
      /Invalid MCP tool name: SystemInfo/,
    );
  });

  it('rejects a destructive tool without confirm', () => {
    expect(() =>
      validateTools([
        tool({ name: 'probe_restart', destructive: true, scope: 'ops' }),
      ]),
    ).toThrow(/probe_restart requires confirm/);
  });

  it('rejects a destructive tool with read scope', () => {
    expect(() =>
      validateTools([
        tool({
          name: 'probe_restart',
          destructive: true,
          scope: 'read',
          input: z.object({ confirm: ConfirmSchema }),
        }),
      ]),
    ).toThrow(/cannot use scope read/);
  });

  it('refuses to boot when the registry is invalid', async () => {
    const app = await createApp({}, [
      tool({ name: 'system_info' }),
      tool({ name: 'system_info' }),
    ]);
    try {
      await expect(app.ready()).rejects.toThrow(/Duplicate MCP tool name/);
    } finally {
      await app.close().catch(() => undefined);
      try {
        app.deps.db.$client.close();
      } catch {
        // close() already released the database
      }
    }
  });
});

describe('mcp endpoint', () => {
  const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const dir of dataDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists the read tools and calls system_info', async () => {
    const app = await createApp();
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const token = await app.deps.auth.createToken({
      name: 'reader',
      scope: 'read',
    });
    const client = await connect(portOf(app), {
      authorization: `Bearer ${token.token}`,
    });

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((item) => item.name).sort()).toEqual([
        'audit_list',
        'system_info',
        'system_snapshot',
      ]);
      const result = await client.callTool({
        name: 'system_info',
        arguments: {},
      });
      const text = textOf(result);
      expect(JSON.parse(text).mode).toBe('fake');
      expect(result.isError).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it('rejects a missing token, a revoked token, a session cookie, and a foreign origin', async () => {
    const app = await createApp();
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = portOf(app);
    const token = await app.deps.auth.createToken({
      name: 'reader',
      scope: 'read',
    });
    app.deps.auth.revokeToken(token.id);

    await expect(connect(port, {})).rejects.toMatchObject({ code: 401 });
    await expect(
      connect(port, { authorization: `Bearer ${token.token}` }),
    ).rejects.toBeInstanceOf(StreamableHTTPError);

    const secret = new Secret({ size: 20 });
    await app.deps.auth.setupUser({
      username: 'operator',
      password: 'correct-horse-battery',
      totpSecret: secret.base32,
    });
    const session = await app.deps.auth.login({
      username: 'operator',
      password: 'correct-horse-battery',
      totp: TOTP.generate({ secret }),
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    const cookie = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie: `omnis_session=${session.sessionId}` },
      payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
    });
    expect(cookie.statusCode).toBe(401);

    const allowed = await app.deps.auth.createToken({
      name: 'still-valid',
      scope: 'read',
    });
    await expect(
      connect(port, {
        authorization: `Bearer ${allowed.token}`,
        origin: 'http://evil.example',
      }),
    ).rejects.toMatchObject({ code: 403 });

    const get = await app.inject({ method: 'GET', url: '/mcp' });
    const del = await app.inject({ method: 'DELETE', url: '/mcp' });
    expect(get.statusCode).toBe(405);
    expect(del.statusCode).toBe(405);
  });

  it('truncates a large result and audits a confirmed destructive tool', async () => {
    const destructive = tool({
      name: 'probe_restart',
      description: 'Test-only destructive tool. Requires confirm.',
      scope: 'ops',
      destructive: true,
      input: z.object({ confirm: ConfirmSchema }),
      handler: async () => ({ ok: true }),
    });
    const blob = tool({
      name: 'probe_blob',
      description: 'Returns a payload larger than 100KB.',
      handler: async () => 'x'.repeat(120_000),
    });
    const app = await createApp({}, [destructive, blob]);
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const port = portOf(app);
    const read = await app.deps.auth.createToken({
      name: 'reader',
      scope: 'read',
    });
    const ops = await app.deps.auth.createToken({
      name: 'operator',
      scope: 'ops',
    });

    const reader = await connect(port, {
      authorization: `Bearer ${read.token}`,
    });
    const operator = await connect(port, {
      authorization: `Bearer ${ops.token}`,
    });
    try {
      const visible = await reader.listTools();
      expect(visible.tools.map((item) => item.name)).toEqual(['probe_blob']);

      const large = await reader.callTool({
        name: 'probe_blob',
        arguments: {},
      });
      const text = textOf(large);
      expect(text).toContain('[truncated: result exceeded 100KB]');
      expect(text.includes('x'.repeat(110_000))).toBe(false);

      const rejected = await operator.callTool({
        name: 'probe_restart',
        arguments: {},
      });
      expect(rejected.isError).toBe(true);
      expect(
        app.deps.audit.list({ limit: 20 }).items.some((item) => {
          return item.action === 'probe_restart';
        }),
      ).toBe(false);

      const accepted = await operator.callTool({
        name: 'probe_restart',
        arguments: { confirm: true },
      });
      expect(accepted.isError).toBeUndefined();
      const entry = app.deps.audit.list({ limit: 20 }).items.find((item) => {
        return item.action === 'probe_restart';
      });
      expect(entry?.source).toBe('mcp');
      expect(entry?.status).toBe('succeeded');
      expect(entry?.actor.type).toBe('token');
    } finally {
      await reader.close();
      await operator.close();
    }
  });
});

function portOf(app: { server: { address: () => unknown } }): number {
  const address = app.server.address();
  if (address && typeof address === 'object' && 'port' in address) {
    return Number(address.port);
  }
  throw new Error('server is not listening');
}

async function connect(
  port: number,
  headers: Record<string, string>,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
    { requestInit: { headers } },
  );
  const client = new Client({ name: 'omnis-test', version: '0.0.0' });
  try {
    await client.connect(transport);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return client;
}

function textOf(result: object): string {
  if (!('content' in result) || !Array.isArray(result.content)) {
    throw new Error('missing text content');
  }
  const text = result.content.find((item: unknown) => {
    return (
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      item.type === 'text' &&
      'text' in item &&
      typeof item.text === 'string'
    );
  });
  if (
    text === undefined ||
    !('text' in text) ||
    typeof text.text !== 'string'
  ) {
    throw new Error('missing text content');
  }
  return text.text;
}
