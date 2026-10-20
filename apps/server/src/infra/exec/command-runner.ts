import { execFile } from 'node:child_process';
import { resolveCommand } from './commands';

export const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export interface CommandRunner {
  run(key: string, args: unknown): Promise<CommandResult>;
}

export type CommandSpawn = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<Pick<CommandResult, 'stdout' | 'stderr' | 'exitCode'>>;

export type AdapterLogger = {
  info: (bindings: Record<string, unknown>, message: string) => void;
};

type ExecFailure = Error & {
  code?: number | string | null;
};

export function createCommandRunner(options: {
  spawn: CommandSpawn;
  logger: AdapterLogger;
}): CommandRunner {
  return {
    async run(key, args) {
      const command = resolveCommand(key, args);
      const started = Date.now();
      try {
        const result = await options.spawn(command.bin, command.argv, {
          timeout: command.timeoutMs,
          maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        });
        const durationMs = Date.now() - started;
        options.logger.info(
          { key, exitCode: result.exitCode, durationMs },
          'command finished',
        );
        return { ...result, durationMs };
      } catch (error) {
        const durationMs = Date.now() - started;
        options.logger.info(
          { key, exitCode: null, durationMs },
          'command finished',
        );
        throw error;
      }
    },
  };
}

export function execFileSpawn(
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
): Promise<Pick<CommandResult, 'stdout' | 'stderr' | 'exitCode'>> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as ExecFailure).code;
          if (typeof code === 'number') {
            resolve({
              stdout: text(stdout),
              stderr: text(stderr),
              exitCode: code,
            });
            return;
          }
          reject(error);
          return;
        }
        resolve({ stdout: text(stdout), stderr: text(stderr), exitCode: 0 });
      },
    );
  });
}

function text(value: string | Buffer | null | undefined): string {
  if (typeof value === 'string') return value;
  if (value instanceof Buffer) return value.toString('utf8');
  return '';
}
