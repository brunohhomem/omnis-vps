import os from 'node:os';
import type { HealthOutput, SystemInfoOutput } from '@omnis/shared';
import type { AppDeps } from '../../deps';
import { version } from '../../version';

export function createSystemService(deps: AppDeps) {
  return {
    getHealth(): HealthOutput {
      return {
        status: 'ok',
        version,
        uptimeSec: process.uptime(),
        rssBytes: process.memoryUsage().rss,
      };
    },
    getInfo(): SystemInfoOutput {
      return {
        hostname: os.hostname(),
        platform: os.platform(),
        kernel: os.release(),
        cpuCount: os.cpus().length,
        totalMemBytes: os.totalmem(),
        nodeVersion: process.version,
        omnisVersion: version,
        mode: deps.config.OMNIS_MODE,
      };
    },
  };
}

export type SystemService = ReturnType<typeof createSystemService>;
