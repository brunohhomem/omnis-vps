import type { FastifyBaseLogger } from 'fastify';
import pino, { type LoggerOptions } from 'pino';
import type { Config } from './config';

export type AppDeps = {
  config: Config;
  logger: FastifyBaseLogger;
  // T004: db · T005: adapters · T006: audit · ...
};

export function createDeps(config: Config): AppDeps {
  return {
    config,
    logger: createLogger(config),
  };
}

function createLogger(config: Config): FastifyBaseLogger {
  const options: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  };

  if (config.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    };
  }

  return pino(options);
}
