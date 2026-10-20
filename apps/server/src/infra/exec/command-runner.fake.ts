import type { CommandResult, CommandRunner } from './command-runner';
import { resolveCommand } from './commands';

export type CommandCall = {
  key: string;
  args: unknown;
};

export type FakeCommandOutput = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type FakeCommandRunner = CommandRunner & {
  calls: CommandCall[];
};

const DEFAULTS: Record<string, Required<FakeCommandOutput>> = {
  'system.uptime': {
    stdout:
      ' 12:00:00 up 1 day,  2:03,  1 user,  load average: 0.15, 0.10, 0.05\n',
    stderr: '',
    exitCode: 0,
  },
};

export function createFakeCommandRunner(
  responses: Record<string, FakeCommandOutput> = {},
): FakeCommandRunner {
  const calls: CommandCall[] = [];
  return {
    calls,
    async run(key, args): Promise<CommandResult> {
      resolveCommand(key, args);
      calls.push({ key, args });
      const preset = { ...DEFAULTS[key], ...responses[key] };
      return {
        stdout: preset.stdout ?? '',
        stderr: preset.stderr ?? '',
        exitCode: preset.exitCode ?? 0,
        durationMs: 0,
      };
    },
  };
}
