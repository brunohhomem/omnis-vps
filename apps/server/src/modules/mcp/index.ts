import { hasScope } from '@omnis/shared';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDeps } from '../../deps';
import { AppError } from '../../core/errors';
import { actorFrom } from '../../core/principal';
import type { ToolDef } from '../../core/tool';
import { version } from '../../version';
import { runTool } from './execute';
import { createToolRegistry, validateTools } from './registry';

type McpPluginOptions = {
  deps: AppDeps;
  tools?: ToolDef[];
};

export const mcpModule: FastifyPluginAsync<McpPluginOptions> = async (
  app,
  options,
) => {
  const tools = options.tools ?? createToolRegistry(options.deps);
  validateTools(tools);

  const limit = app.rateLimit({
    max: 60,
    timeWindow: 60_000,
    groupId: 'mcp',
    keyGenerator: (request) => request.principal?.id ?? 'anonymous',
    errorResponseBuilder: () =>
      new AppError('RATE_LIMITED', 'Too many requests', 429),
  });

  app.post(
    '/mcp',
    { preHandler: [authenticate(options.deps), limit] },
    async (request, reply) => {
      const principal = request.principal;
      if (!principal) throw unauthorized();
      const ctx = {
        principal,
        actor: actorFrom(principal),
        source: 'mcp' as const,
      };
      const server = new McpServer({ name: 'omnis', version });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      for (const tool of tools) {
        if (!hasScope(principal.scope, tool.scope)) continue;
        server.registerTool(
          tool.name,
          { description: tool.description, inputSchema: tool.input },
          async (args) => runTool(options.deps, tool, args, ctx),
        );
      }

      reply.hijack();
      reply.raw.on('close', () => {
        void transport.close().finally(() => server.close());
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } catch (error) {
        request.log.error({ err: error }, 'mcp request failed');
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, {
            'content-type': 'application/json; charset=utf-8',
          });
          reply.raw.end(
            JSON.stringify({
              error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
              },
            }),
          );
        } else if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    },
  );

  app.get('/mcp', async (_request, reply) => methodNotAllowed(reply));
  app.delete('/mcp', async (_request, reply) => methodNotAllowed(reply));
};

function authenticate(deps: AppDeps) {
  return async (request: FastifyRequest) => {
    assertOrigin(request, deps.config.MCP_ALLOWED_ORIGINS);
    const token = bearerToken(request.headers.authorization);
    const principal = deps.auth.authenticateBearer(token);
    if (!principal) throw unauthorized();
    request.principal = principal;
  };
}

function assertOrigin(request: FastifyRequest, allowed: string[]): void {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin === 'string' && allowed.includes(origin)) return;
  throw new AppError('FORBIDDEN', 'Origin not allowed', 403);
}

function bearerToken(header: string | undefined): string {
  if (header === undefined) throw unauthorized();
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || token === undefined || !token.startsWith('omn_')) {
    throw unauthorized();
  }
  return token;
}

function unauthorized(): AppError {
  return new AppError('UNAUTHORIZED', 'Unauthorized', 401);
}

function methodNotAllowed(reply: FastifyReply): unknown {
  reply.header('allow', 'POST');
  return reply.code(405).send({ message: 'Method not allowed' });
}
