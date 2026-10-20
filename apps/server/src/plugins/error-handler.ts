import type { ErrorCode, ApiError } from '@omnis/shared';
import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../core/errors';
import type { AppDeps } from '../deps';

const GENERIC_MESSAGE = 'Internal server error';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

function errorBody(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ApiError {
  if (details === undefined) {
    return { error: { code, message } };
  }
  return { error: { code, message, details } };
}

function sendJson(reply: FastifyReply, statusCode: number, body: ApiError) {
  return reply
    .code(statusCode)
    .type('application/json; charset=utf-8')
    .serializer((payload) => JSON.stringify(payload))
    .send(body);
}

export function sendNotFound(reply: FastifyReply, request: FastifyRequest) {
  return sendJson(
    reply,
    404,
    errorBody('NOT_FOUND', `Route ${request.method} ${request.url} not found`),
  );
}

function statusCodeOf(error: FastifyError): number | undefined {
  return typeof error.statusCode === 'number' ? error.statusCode : undefined;
}

export function registerErrorHandler(
  app: FastifyInstance,
  deps: AppDeps,
): void {
  const isProduction = deps.config.NODE_ENV === 'production';

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'request failed');
      }
      return sendJson(
        reply,
        error.statusCode,
        errorBody(error.code, error.message, error.details),
      );
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendJson(
        reply,
        400,
        errorBody('VALIDATION_ERROR', 'Validation failed', {
          issues: error.validation,
        }),
      );
    }

    const statusCode = statusCodeOf(error);
    const isServerError =
      isResponseSerializationError(error) ||
      statusCode === undefined ||
      statusCode >= 500;

    if (isServerError) {
      request.log.error({ err: error }, 'request failed');
      const message = isProduction ? GENERIC_MESSAGE : error.message;
      const httpStatus =
        statusCode !== undefined && statusCode >= 400 ? statusCode : 500;
      return sendJson(reply, httpStatus, errorBody('INTERNAL_ERROR', message));
    }

    const code = STATUS_TO_CODE[statusCode] ?? 'INTERNAL_ERROR';
    return sendJson(reply, statusCode, errorBody(code, error.message));
  });
}
