import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppDeps } from './deps';
import type { ToolDef } from './core/tool';
import { auditModule } from './modules/audit';
import { authModule } from './modules/auth';
import { mcpModule } from './modules/mcp';
import { systemModule } from './modules/system';
import { registerAuthHook } from './plugins/authenticate';
import { registerErrorHandler, sendNotFound } from './plugins/error-handler';
import { registerStaticWeb, resolveWebDistRoot } from './plugins/static-web';

export function buildApp(deps: AppDeps, options: { tools?: ToolDef[] } = {}) {
  const app = Fastify({
    loggerInstance: deps.logger,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onClose', async () => {
    deps.db.$client.close();
  });
  registerErrorHandler(app, deps);
  registerAuthHook(app, deps);

  track(app.register(cookie));
  track(app.register(rateLimit, { global: false }));
  track(app.register(authModule, { prefix: '/api', deps }));
  track(app.register(auditModule, { prefix: '/api', deps }));
  track(app.register(systemModule, { prefix: '/api', deps }));
  track(app.register(mcpModule, { deps, tools: options.tools }));

  const webRoot = resolveWebDistRoot(deps);
  if (webRoot) {
    registerStaticWeb(app, webRoot);
  } else {
    app.setNotFoundHandler((request, reply) => sendNotFound(reply, request));
  }

  return app;
}

function track(registered: PromiseLike<unknown>): void {
  void Promise.resolve(registered).catch(() => undefined);
}
