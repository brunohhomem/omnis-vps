import { hasScope } from '@omnis/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps';
import { getClientIp } from '../core/client-ip';
import { AppError } from '../core/errors';

const UNAUTHORIZED_MESSAGE = 'Unauthorized';

export function registerAuthHook(app: FastifyInstance, deps: AppDeps): void {
  app.addHook('preHandler', async (request) => {
    if (request.is404) return;
    const path = request.url.split('?')[0] ?? request.url;
    if (!path.startsWith('/api') || isPublic(request.method, path)) return;

    const header = request.headers.authorization;
    let principal = null;
    if (header !== undefined) {
      const token = bearerToken(header);
      principal = deps.auth.authenticateBearer(token);
      if (!principal) throw unauthorized();
    } else {
      const sessionId = request.cookies.omnis_session;
      if (sessionId) principal = deps.auth.authenticateSession(sessionId);
    }
    if (!principal) throw unauthorized();

    if (request.routeOptions.config.sessionOnly && principal.type !== 'user') {
      throw new AppError('FORBIDDEN', 'Session required', 403);
    }
    const required = request.routeOptions.config.scope ?? 'read';
    if (!hasScope(principal.scope, required)) {
      throw new AppError('FORBIDDEN', 'Insufficient scope', 403);
    }
    request.principal = principal;
  });
}

export function loginRateLimits(app: FastifyInstance, deps: AppDeps) {
  const errorResponseBuilder = () =>
    new AppError('RATE_LIMITED', 'Too many requests', 429);
  return [
    app.rateLimit({
      max: 5,
      timeWindow: 60_000,
      groupId: 'login-minute',
      keyGenerator: (request) => `m:${getClientIp(request, deps.config)}`,
      errorResponseBuilder,
    }),
    app.rateLimit({
      max: 20,
      timeWindow: 3_600_000,
      groupId: 'login-hour',
      keyGenerator: (request) => `h:${getClientIp(request, deps.config)}`,
      errorResponseBuilder,
    }),
  ];
}

function isPublic(method: string, path: string): boolean {
  return (
    (method === 'GET' && path === '/api/health') ||
    (method === 'POST' && path === '/api/auth/login')
  );
}

function bearerToken(header: string): string {
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || token === undefined || !token.startsWith('omn_')) {
    throw unauthorized();
  }
  return token;
}

function unauthorized(): AppError {
  return new AppError('UNAUTHORIZED', UNAUTHORIZED_MESSAGE, 401);
}
