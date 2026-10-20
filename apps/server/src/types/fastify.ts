import type { Scope } from '@omnis/shared';
import type { Principal } from '../core/principal';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }

  interface FastifyContextConfig {
    scope?: Scope;
    sessionOnly?: boolean;
  }
}
