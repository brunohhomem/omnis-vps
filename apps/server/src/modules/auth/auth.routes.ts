import { z } from 'zod';
import {
  LoginInputSchema,
  MeOutputSchema,
  TokenCreateInputSchema,
  TokenCreateOutputSchema,
  TokenListOutputSchema,
} from '@omnis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { getClientIp } from '../../core/client-ip';
import { actorFrom } from '../../core/principal';
import { withAudit } from '../../core/with-audit';
import { loginRateLimits } from '../../plugins/authenticate';

const TokenIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const COOKIE = 'omnis_session';

export function authRoutes(deps: AppDeps): FastifyPluginAsyncZod {
  const { auth, audit, config } = deps;
  return async (app) => {
    app.post(
      '/auth/login',
      {
        preHandler: loginRateLimits(app, deps),
        schema: { body: LoginInputSchema },
      },
      async (request, reply) => {
        const { username, password, totp } = request.body;
        await withAudit(
          audit,
          { actor: { type: 'user', id: null, label: username }, source: 'ui' },
          { action: 'auth.login', target: username },
          async () => {
            const { sessionId } = await auth.login({
              username,
              password,
              totp,
              ip: getClientIp(request, config),
              userAgent: headerValue(request.headers['user-agent']),
            });
            reply.setCookie(COOKIE, sessionId, cookieOptions(config));
          },
        );
        return reply.code(204).send();
      },
    );

    app.post(
      '/auth/logout',
      { config: { sessionOnly: true } },
      async (request, reply) => {
        const principal = request.principal;
        if (!principal) return reply.code(401).send();
        await withAudit(
          audit,
          { actor: actorFrom(principal), source: 'ui' },
          { action: 'auth.logout' },
          async () => {
            const sessionId = request.cookies.omnis_session;
            if (sessionId) auth.logout(sessionId);
            reply.clearCookie(COOKIE, { path: '/' });
          },
        );
        return reply.code(204).send();
      },
    );

    app.get(
      '/auth/me',
      { schema: { response: { 200: MeOutputSchema } } },
      async (request) => {
        if (!request.principal) {
          throw new Error('missing principal');
        }
        return auth.me(request.principal);
      },
    );

    app.get(
      '/auth/tokens',
      {
        config: { sessionOnly: true },
        schema: { response: { 200: TokenListOutputSchema } },
      },
      async () => auth.listTokens(),
    );

    app.post(
      '/auth/tokens',
      {
        config: { sessionOnly: true },
        schema: {
          body: TokenCreateInputSchema,
          response: { 200: TokenCreateOutputSchema },
        },
      },
      async (request) => {
        if (!request.principal) throw new Error('missing principal');
        const principal = request.principal;
        const { name, scope, expiresInDays } = request.body;
        return withAudit(
          audit,
          { actor: actorFrom(principal), source: 'ui' },
          { action: 'auth.token.create', params: { name, scope } },
          () => auth.createToken({ name, scope, expiresInDays }),
        );
      },
    );

    app.delete(
      '/auth/tokens/:id',
      {
        config: { sessionOnly: true },
        schema: { params: TokenIdParamsSchema },
      },
      async (request, reply) => {
        if (!request.principal) throw new Error('missing principal');
        const principal = request.principal;
        const token = auth.describeToken(request.params.id);
        await withAudit(
          audit,
          { actor: actorFrom(principal), source: 'ui' },
          {
            action: 'auth.token.revoke',
            target: token.name,
            params: { name: token.name, scope: token.scope },
          },
          async () => {
            auth.revokeToken(request.params.id);
          },
        );
        return reply.code(204).send();
      },
    );
  };
}

function cookieOptions(config: AppDeps['config']) {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: config.SESSION_TTL_HOURS * 60 * 60,
  };
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}
