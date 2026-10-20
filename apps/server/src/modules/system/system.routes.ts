import {
  HealthOutputSchema,
  SystemInfoOutputSchema,
  SystemSnapshotSchema,
} from '@omnis/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { SystemService } from './system.service';

export function systemRoutes(service: SystemService): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/health',
      {
        schema: {
          response: {
            200: HealthOutputSchema,
          },
        },
      },
      async () => service.getHealth(),
    );

    app.get(
      '/system/info',
      {
        schema: {
          response: {
            200: SystemInfoOutputSchema,
          },
        },
      },
      async () => service.getInfo(),
    );

    app.get(
      '/system/snapshot',
      {
        schema: {
          response: {
            200: SystemSnapshotSchema,
          },
        },
      },
      async () => service.getSnapshot(),
    );
  };
}
