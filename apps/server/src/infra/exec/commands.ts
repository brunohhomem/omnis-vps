import { z } from 'zod';
import { AppError } from '../../core/errors';

export type CommandDef<A extends z.ZodType> = {
  key: string;
  bin: string;
  args: A;
  buildArgv: (args: z.infer<A>) => string[];
  timeoutMs: number;
  sudo?: boolean;
};

export type ResolvedCommand = {
  key: string;
  bin: string;
  argv: string[];
  timeoutMs: number;
};

export const commands: CommandDef<z.ZodType>[] = [
  {
    key: 'system.uptime',
    bin: '/usr/bin/uptime',
    args: z.object({}).strict(),
    buildArgv: () => [],
    timeoutMs: 5_000,
  },
];

export function resolveCommand(key: string, args: unknown): ResolvedCommand {
  const command = commands.find((entry) => entry.key === key);
  if (!command) {
    throw new AppError('ADAPTER_UNAVAILABLE', `Unknown command: ${key}`, 503);
  }

  const parsed = command.args.safeParse(args);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Invalid command arguments',
      400,
      parsed.error.issues,
    );
  }

  return {
    key: command.key,
    bin: command.bin,
    argv: command.buildArgv(parsed.data),
    timeoutMs: command.timeoutMs,
  };
}
