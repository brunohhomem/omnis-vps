import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { auditRoutes } from './audit.routes';

export const auditModule: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (
  app,
  options,
) => {
  await app.register(auditRoutes(options.deps.audit));
};
