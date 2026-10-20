import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { createSystemService } from './system.service';
import { systemRoutes } from './system.routes';

export const systemModule: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (
  app,
  options,
) => {
  const service = createSystemService(options.deps);
  await app.register(systemRoutes(service));
};
