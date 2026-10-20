import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps';
import { sendNotFound } from './error-handler';

function isDirectory(dirPath: string): boolean {
  try {
    return statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function pathnameOf(url: string): string {
  return url.split('?')[0] ?? url;
}

function isReservedPath(pathname: string): boolean {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/mcp' ||
    pathname.startsWith('/mcp/')
  );
}

export function resolveWebDistRoot(deps: AppDeps): string | undefined {
  const configured = deps.config.WEB_DIST_DIR;
  if (configured === undefined) {
    deps.logger.warn('WEB_DIST_DIR is not set; static web will not be served');
    return undefined;
  }

  const root = path.resolve(configured);
  if (!isDirectory(root)) {
    deps.logger.warn(
      { webDistDir: root },
      'WEB_DIST_DIR does not exist; static web will not be served',
    );
    return undefined;
  }

  return root;
}

export function registerStaticWeb(app: FastifyInstance, root: string): void {
  const notFoundPage = path.join(root, '404.html');

  void app.register(fastifyStatic, {
    root,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    const pathname = pathnameOf(request.url);
    if (
      request.method === 'GET' &&
      !isReservedPath(pathname) &&
      existsSync(notFoundPage)
    ) {
      return reply.code(404).sendFile('404.html');
    }
    return sendNotFound(reply, request);
  });
}
