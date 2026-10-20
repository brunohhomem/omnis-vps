import { AuditListInputSchema } from '@omnis/shared';
import type { AuditService } from './audit.service';
import type { ToolDef } from '../../core/tool';

export function createAuditTools(services: { audit: AuditService }): ToolDef[] {
  return [
    {
      name: 'audit_list',
      description:
        'List audit log entries, newest first. Filter by action, status, source, and time range, and page with cursor and limit. Use this to see who changed state and whether it succeeded. It does not change anything.',
      scope: 'read',
      destructive: false,
      input: AuditListInputSchema,
      handler: async (input) =>
        services.audit.list(AuditListInputSchema.parse(input)),
    },
  ];
}
