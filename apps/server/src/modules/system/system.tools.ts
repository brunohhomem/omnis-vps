import { z } from 'zod';
import type { SystemService } from './system.service';
import type { ToolDef } from '../../core/tool';

const EmptyInput = z.object({});

export function createSystemTools(services: {
  system: SystemService;
}): ToolDef[] {
  return [
    {
      name: 'system_info',
      description:
        'Read the host identity: hostname, platform, kernel, CPU count, total memory, Node.js version, Omnis version, and whether the process is in real or fake mode. Use this when asked what machine Omnis is running on. It does not change anything.',
      scope: 'read',
      destructive: false,
      input: EmptyInput,
      handler: async () => services.system.getInfo(),
    },
    {
      name: 'system_snapshot',
      description:
        'Read current CPU usage, load averages, memory, swap, disks, network counters, and uptime. Use this when asked how the machine is doing right now. It does not change anything.',
      scope: 'read',
      destructive: false,
      input: EmptyInput,
      handler: async () => services.system.getSnapshot(),
    },
  ];
}
