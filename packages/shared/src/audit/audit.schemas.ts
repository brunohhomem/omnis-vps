import { z } from 'zod';
import { IsoDateTimeSchema } from '../common/primitives';
import { paginated, PaginationQuerySchema } from '../common/pagination';

export const AuditSourceSchema = z.enum(['ui', 'mcp', 'scheduler', 'system']);

export type AuditSource = z.infer<typeof AuditSourceSchema>;

export const AuditStatusSchema = z.enum([
  'started',
  'succeeded',
  'failed',
  'interrupted',
]);

export type AuditStatus = z.infer<typeof AuditStatusSchema>;

export const ActorSchema = z.object({
  type: z.enum(['user', 'token', 'system']),
  id: z.string().nullable(),
  label: z.string(),
});

export type Actor = z.infer<typeof ActorSchema>;

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
  actor: ActorSchema,
  source: AuditSourceSchema,
  action: z.string(),
  target: z.string().nullable(),
  params: z.unknown().nullable(),
  status: AuditStatusSchema,
  error: z.string().nullable(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditListInputSchema = PaginationQuerySchema.extend({
  action: z.string().min(1).optional(),
  status: AuditStatusSchema.optional(),
  source: AuditSourceSchema.optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});

export type AuditListInput = z.infer<typeof AuditListInputSchema>;

export const AuditListOutputSchema = paginated(AuditEntrySchema);

export type AuditListOutput = z.infer<typeof AuditListOutputSchema>;
