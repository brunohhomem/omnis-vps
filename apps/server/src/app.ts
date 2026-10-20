import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppDeps } from './deps';
import { auditModule } from './modules/audit';
import { systemModule } from './modules/system';
import { registerErrorHandler, sendNotFound } from './plugins/error-handler';
import { registerStaticWeb, resolveWebDistRoot } from './plugins/static-web';

export function buildApp(deps: AppDeps) {
  const app = Fastify({
    loggerInstance: deps.logger,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onClose', async () => {
    deps.db.$client.close();
  });
  registerErrorHandler(app, deps);

  void app.register(auditModule, { prefix: '/api', deps });
  void app.register(systemModule, { prefix: '/api', deps });

  const webRoot = resolveWebDistRoot(deps);
  if (webRoot) {
    registerStaticWeb(app, webRoot);
  } else {
    app.setNotFoundHandler((request, reply) => sendNotFound(reply, request));
  }

  return app;
}
