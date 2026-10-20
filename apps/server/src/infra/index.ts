import type { Config } from '../config';
import {
  createCommandRunner,
  execFileSpawn,
  type AdapterLogger,
  type CommandRunner,
} from './exec/command-runner';
import { createFakeCommandRunner } from './exec/command-runner.fake';
import type { SystemAdapter } from './system/system.adapter';
import { createFakeSystemAdapter } from './system/system.fake';
import { createLinuxSystemAdapter } from './system/system.linux';

export type {
  AdapterLogger,
  CommandRunner,
  CommandResult,
} from './exec/command-runner';
export type { SystemAdapter } from './system/system.adapter';

export type Adapters = {
  system: SystemAdapter;
  exec: CommandRunner;
};

const REAL_REQUIRES_LINUX =
  'OMNIS_MODE=real exige Linux; use OMNIS_MODE=fake no desenvolvimento';

export function createAdapters(
  config: Config,
  logger: AdapterLogger,
): Adapters {
  if (config.OMNIS_MODE === 'fake') {
    return {
      system: createFakeSystemAdapter(),
      exec: createFakeCommandRunner(),
    };
  }

  if (process.platform !== 'linux') {
    throw new Error(REAL_REQUIRES_LINUX);
  }

  return {
    system: createLinuxSystemAdapter(config.DISK_MOUNTS),
    exec: createCommandRunner({ spawn: execFileSpawn, logger }),
  };
}
