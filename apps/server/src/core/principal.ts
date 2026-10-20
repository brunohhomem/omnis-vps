import type { Actor, Scope } from '@omnis/shared';

export type Principal = {
  type: 'user' | 'token';
  id: string;
  label: string;
  scope: Scope;
};

export function actorFrom(principal: Principal): Actor {
  return {
    type: principal.type === 'user' ? 'user' : 'token',
    id: principal.id,
    label: principal.label,
  };
}
