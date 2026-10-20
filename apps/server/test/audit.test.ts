import { AuditListOutputSchema } from '@omnis/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ANONYMOUS_ACTOR, withAudit } from '../src/core/with-audit';
import { sanitize } from '../src/core/sanitize';
import {
  createAuditService,
  type AuditLogger,
  type AuditService,
} from '../src/modules/audit/audit.service';
import { createTestDb } from './helpers/test-db';

const silent: AuditLogger = { warn() {} };

describe('sanitize', () => {
  it('redacts sensitive keys at any depth and truncates long strings', () => {
    const note = 'a'.repeat(501);
    const value = sanitize({
      note,
      nested: {
        password: 'hunter2',
        accessToken: 'tok',
        profile: { content: 'file-body', name: 'ok' },
      },
    });

    expect(value).toEqual({
      note: `${'a'.repeat(500)}…[truncado]`,
      nested: {
        password: '[REDACTED]',
        accessToken: '[REDACTED]',
        profile: { content: '[REDACTED]', name: 'ok' },
      },
    });
  });

  it('stops walking after five levels', () => {
    let value: unknown = { secret: 'bottom' };
    for (let i = 0; i < 5; i += 1) value = { child: value };

    const sanitized = sanitize(value);
    expect(JSON.stringify(sanitized)).not.toContain('bottom');
    expect(sanitized).toEqual({
      child: { child: { child: { child: { child: '[MAX_DEPTH]' } } } },
    });
  });
});

describe('audit', () => {
  const connections: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
  });

  it('records the start before the action and closes it on success', async () => {
    const { sqlite, audit } = await openAudit();
    connections.push(sqlite);

    const result = await withAudit(
      audit,
      { actor: ANONYMOUS_ACTOR, source: 'ui' },
      { action: 'processes.restart', target: 'api', params: { token: 'x' } },
      async () => {
        const pending = audit.list({ limit: 10 });
        expect(pending.items).toHaveLength(1);
        expect(pending.items[0]?.status).toBe('started');
        expect(pending.items[0]?.finishedAt).toBeNull();
        expect(pending.items[0]?.params).toEqual({ token: '[REDACTED]' });
        return 'done';
      },
    );

    expect(result).toBe('done');
    const [entry] = audit.list({ limit: 10 }).items;
    expect(entry?.status).toBe('succeeded');
    expect(entry?.finishedAt).not.toBeNull();
    expect(entry?.actor).toEqual(ANONYMOUS_ACTOR);
    expect(entry?.target).toBe('api');
  });

  it('marks a failure and rethrows the original error', async () => {
    const { sqlite, audit } = await openAudit();
    connections.push(sqlite);
    const failure = new Error('disk full');
    failure.stack = 'Error: disk full\n    at secret-frame';

    await expect(
      withAudit(
        audit,
        { actor: ANONYMOUS_ACTOR, source: 'mcp' },
        { action: 'files.write', target: 'app.env' },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);

    const [entry] = audit.list({ limit: 10 }).items;
    expect(entry?.status).toBe('failed');
    expect(entry?.error).toBe('disk full');
    expect(entry?.error).not.toContain('secret-frame');
    expect(entry?.finishedAt).not.toBeNull();
  });

  it('interrupts only entries that were still started', async () => {
    const warnings: unknown[] = [];
    const { sqlite, audit } = await openAudit({
      warn(bindings) {
        warnings.push(bindings);
      },
    });
    connections.push(sqlite);

    const done = audit.start({
      actor: ANONYMOUS_ACTOR,
      source: 'system',
      action: 'processes.restart',
    });
    audit.succeed(done);
    const pending = audit.start({
      actor: ANONYMOUS_ACTOR,
      source: 'scheduler',
      action: 'files.write',
    });
    const failed = audit.start({
      actor: ANONYMOUS_ACTOR,
      source: 'ui',
      action: 'processes.stop',
    });
    audit.fail(failed, 'nope');

    expect(audit.reconcileInterrupted()).toBe(1);
    expect(warnings).toEqual([{ count: 1 }]);
    expect(audit.reconcileInterrupted()).toBe(0);

    const byId = new Map(
      audit.list({ limit: 10 }).items.map((entry) => [entry.id, entry.status]),
    );
    expect(byId.get(done)).toBe('succeeded');
    expect(byId.get(pending)).toBe('interrupted');
    expect(byId.get(failed)).toBe('failed');
  });

  it('filters, orders by id descending and ends the cursor', async () => {
    const { sqlite, db, audit } = await openAudit();
    connections.push(sqlite);
    const first = audit.start({
      actor: ANONYMOUS_ACTOR,
      source: 'ui',
      action: 'processes.restart',
      target: 'api',
    });
    audit.succeed(first);
    const second = audit.start({
      actor: ANONYMOUS_ACTOR,
      source: 'mcp',
      action: 'files.write',
      target: 'app.env',
    });
    audit.fail(second, 'denied');
    const third = audit.start({
      actor: ANONYMOUS_ACTOR,
      source: 'system',
      action: 'processes.restart',
      target: 'web',
    });

    const page = audit.list({ limit: 2 });
    expect(page.items.map((entry) => entry.id)).toEqual([third, second]);
    expect(page.nextCursor).toBe(String(second));

    const rest = audit.list({ limit: 2, cursor: page.nextCursor ?? undefined });
    expect(rest.items.map((entry) => entry.id)).toEqual([first]);
    expect(rest.nextCursor).toBeNull();
    AuditListOutputSchema.parse(rest);

    expect(
      audit.list({ limit: 10, action: 'processes.restart' }).items,
    ).toHaveLength(2);
    expect(audit.list({ limit: 10, status: 'failed' }).items[0]?.id).toBe(
      second,
    );
    expect(audit.list({ limit: 10, source: 'mcp' }).items[0]?.id).toBe(second);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(audit.list({ limit: 10, from: future }).items).toEqual([]);
    expect(audit.list({ limit: 10, to: past }).items).toEqual([]);
    expect(
      audit.list({ limit: 10, from: past, to: future }).items,
    ).toHaveLength(3);

    db.$client
      .prepare('UPDATE audit_log SET started_at = ? WHERE id = ?')
      .run(Date.now() - 10_000, first);
    expect(audit.purgeOlderThan(new Date(Date.now() - 5_000))).toBe(1);
    expect(audit.list({ limit: 10 }).items.map((entry) => entry.id)).toEqual([
      third,
      second,
    ]);
  });

  it('rejects a cursor that is not an id', async () => {
    const { sqlite, audit } = await openAudit();
    connections.push(sqlite);
    expect(() => audit.list({ limit: 10, cursor: 'nope' })).toThrow(
      /Invalid cursor/,
    );
  });
});

async function openAudit(logger: AuditLogger = silent): Promise<{
  sqlite: { close: () => void };
  db: Awaited<ReturnType<typeof createTestDb>>['db'];
  audit: AuditService;
}> {
  const opened = await createTestDb();
  return {
    sqlite: opened.sqlite,
    db: opened.db,
    audit: createAuditService({ db: opened.db, logger }),
  };
}
