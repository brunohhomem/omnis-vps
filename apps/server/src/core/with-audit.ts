import type { Actor, AuditSource } from '@omnis/shared';
import type { AuditService } from '../modules/audit/audit.service';

export const ANONYMOUS_ACTOR: Actor = {
  type: 'system',
  id: null,
  label: 'anonymous',
};

export async function withAudit<T>(
  audit: AuditService,
  ctx: { actor: Actor; source: AuditSource },
  meta: { action: string; target?: string; params?: unknown },
  fn: () => Promise<T>,
): Promise<T> {
  const id = audit.start({
    actor: ctx.actor,
    source: ctx.source,
    action: meta.action,
    target: meta.target,
    params: meta.params,
  });

  try {
    const result = await fn();
    audit.succeed(id);
    return result;
  } catch (error) {
    audit.fail(id, error);
    throw error;
  }
}
