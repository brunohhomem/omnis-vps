import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { authRoutes } from './auth.routes';

export const authModule: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (
  app,
  options,
) => {
  await app.register(authRoutes(options.deps));
};
