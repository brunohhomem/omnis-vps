import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    startedAt: integer('started_at', { mode: 'number' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'number' }),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    actorLabel: text('actor_label').notNull(),
    source: text('source').notNull(),
    action: text('action').notNull(),
    target: text('target'),
    params: text('params'),
    status: text('status').notNull(),
    error: text('error'),
  },
  (table) => [
    index('audit_log_started_at_idx').on(table.startedAt),
    index('audit_log_action_idx').on(table.action),
    index('audit_log_status_idx').on(table.status),
  ],
);
