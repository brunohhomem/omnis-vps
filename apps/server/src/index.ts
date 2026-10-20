import { buildApp } from './app';
import { loadConfig } from './config';
import { createDeps } from './deps';
import { version } from './version';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const config = loadConfig();
const deps = await createDeps(config).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`failed to start: ${message}\n`);
  process.exit(1);
});
const app = buildApp(deps);

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');

  const timeout = setTimeout(() => {
    app.log.error('shutdown timed out after 10s');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  try {
    await app.close();
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info(
    {
      host: config.HOST,
      port: config.PORT,
      mode: config.OMNIS_MODE,
      version,
    },
    'omnis listening',
  );
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
