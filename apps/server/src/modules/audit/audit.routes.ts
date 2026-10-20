import { AuditListInputSchema, AuditListOutputSchema } from '@omnis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuditService } from './audit.service';

export function auditRoutes(service: AuditService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/audit',
      {
        schema: {
          querystring: AuditListInputSchema,
          response: {
            200: AuditListOutputSchema,
          },
        },
      },
      async (request) => service.list(request.query),
    );
  };
}
