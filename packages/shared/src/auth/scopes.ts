import { z } from 'zod';

export const ScopeSchema = z.enum(['read', 'ops', 'admin']);

export type Scope = z.infer<typeof ScopeSchema>;

export const SCOPE_RANK = { read: 1, ops: 2, admin: 3 } as const;

export function hasScope(granted: Scope, required: Scope): boolean {
  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}
