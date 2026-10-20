import {
  AuditEntrySchema,
  type Actor,
  type AuditEntry,
  type AuditListInput,
  type AuditListOutput,
  type AuditSource,
} from '@omnis/shared';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import { AppError } from '../../core/errors';
import { sanitize } from '../../core/sanitize';
import type { AppDatabase } from '../../db/client';
import { auditLog } from '../../db/schema/audit';

export type AuditLogger = {
  warn: (bindings: Record<string, unknown>, message: string) => void;
};

export type AuditStartInput = {
  actor: Actor;
  source: AuditSource;
  action: string;
  target?: string;
  params?: unknown;
};

export function createAuditService(deps: {
  db: AppDatabase;
  logger: AuditLogger;
}) {
  return {
    start(input: AuditStartInput): number {
      const result = deps.db
        .insert(auditLog)
        .values({
          startedAt: Date.now(),
          actorType: input.actor.type,
          actorId: input.actor.id,
          actorLabel: input.actor.label,
          source: input.source,
          action: input.action,
          target: input.target ?? null,
          params: storedParams(input.params),
          status: 'started',
        })
        .run();
      return Number(result.lastInsertRowid);
    },

    succeed(id: number): void {
      const result = deps.db
        .update(auditLog)
        .set({ status: 'succeeded', finishedAt: Date.now() })
        .where(eq(auditLog.id, id))
        .run();
      if (result.changes === 0) {
        throw new AppError('NOT_FOUND', `Audit entry ${id} not found`, 404);
      }
    },

    fail(id: number, error: unknown): void {
      const result = deps.db
        .update(auditLog)
        .set({
          status: 'failed',
          finishedAt: Date.now(),
          error: errorMessage(error),
        })
        .where(eq(auditLog.id, id))
        .run();
      if (result.changes === 0) {
        throw new AppError('NOT_FOUND', `Audit entry ${id} not found`, 404);
      }
    },

    reconcileInterrupted(): number {
      const result = deps.db
        .update(auditLog)
        .set({ status: 'interrupted', finishedAt: Date.now() })
        .where(eq(auditLog.status, 'started'))
        .run();
      if (result.changes > 0) {
        deps.logger.warn(
          { count: result.changes },
          'reconciled interrupted audit entries',
        );
      }
      return result.changes;
    },

    list(input: AuditListInput): AuditListOutput {
      const conditions: SQL[] = [];
      if (input.cursor !== undefined) {
        conditions.push(lt(auditLog.id, cursorId(input.cursor)));
      }
      if (input.action !== undefined) {
        conditions.push(eq(auditLog.action, input.action));
      }
      if (input.status !== undefined) {
        conditions.push(eq(auditLog.status, input.status));
      }
      if (input.source !== undefined) {
        conditions.push(eq(auditLog.source, input.source));
      }
      if (input.from !== undefined) {
        conditions.push(gte(auditLog.startedAt, Date.parse(input.from)));
      }
      if (input.to !== undefined) {
        conditions.push(lte(auditLog.startedAt, Date.parse(input.to)));
      }

      const rows = deps.db
        .select()
        .from(auditLog)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLog.id))
        .limit(input.limit + 1)
        .all();
      const page = rows.slice(0, input.limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toEntry),
        nextCursor: rows.length > input.limit && last ? String(last.id) : null,
      };
    },

    purgeOlderThan(date: Date): number {
      const result = deps.db
        .delete(auditLog)
        .where(lt(auditLog.startedAt, date.getTime()))
        .run();
      return result.changes;
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;

function storedParams(params: unknown): string | null {
  if (params === undefined || params === null) return null;
  return JSON.stringify(sanitize(params));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function cursorId(cursor: string): number {
  if (!/^[1-9]\d*$/.test(cursor)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid cursor', 400);
  }
  return Number(cursor);
}

function toEntry(row: typeof auditLog.$inferSelect): AuditEntry {
  return AuditEntrySchema.parse({
    id: row.id,
    startedAt: new Date(row.startedAt).toISOString(),
    finishedAt:
      row.finishedAt == null ? null : new Date(row.finishedAt).toISOString(),
    actor: {
      type: row.actorType,
      id: row.actorId,
      label: row.actorLabel,
    },
    source: row.source,
    action: row.action,
    target: row.target,
    params: row.params == null ? null : JSON.parse(row.params),
    status: row.status,
    error: row.error,
  });
}
