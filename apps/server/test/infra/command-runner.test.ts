import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/core/errors';
import {
  COMMAND_MAX_BUFFER_BYTES,
  createCommandRunner,
  execFileSpawn,
  type AdapterLogger,
} from '../../src/infra/exec/command-runner';
import { createFakeCommandRunner } from '../../src/infra/exec/command-runner.fake';

const silent: AdapterLogger = { info() {} };

describe('command runner', () => {
  it('rejects an unknown command before spawning', async () => {
    const spawn = vi.fn();
    const runner = createCommandRunner({ spawn, logger: silent });

    await expect(runner.run('system.reboot', {})).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects invalid arguments before spawning', async () => {
    const spawn = vi.fn();
    const runner = createCommandRunner({ spawn, logger: silent });

    await expect(
      runner.run('system.uptime', { extra: true }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      runner.run('system.uptime', { extra: true }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('calls the injected spawn without a shell and logs only the outcome', async () => {
    const spawn = vi.fn(async () => ({
      stdout: 'secret-output',
      stderr: '',
      exitCode: 0,
    }));
    const entries: Array<Record<string, unknown>> = [];
    const runner = createCommandRunner({
      spawn,
      logger: {
        info(bindings) {
          entries.push(bindings);
        },
      },
    });

    const result = await runner.run('system.uptime', {});

    expect(spawn).toHaveBeenCalledWith('/usr/bin/uptime', [], {
      timeout: 5_000,
      maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    });
    expect(result.stdout).toBe('secret-output');
    expect(result.exitCode).toBe(0);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: 'system.uptime', exitCode: 0 });
    expect(entries[0]).not.toHaveProperty('stdout');
    expect(entries[0]).not.toHaveProperty('argv');
    expect(JSON.stringify(entries[0])).not.toContain('secret-output');
    expect(JSON.stringify(entries[0])).not.toContain('/usr/bin/uptime');
  });

  it('stops a process that exceeds the timeout', async () => {
    const started = Date.now();
    await expect(
      execFileSpawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
        timeout: 200,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
      }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('fake command runner', () => {
  it('returns the configured output and records the call', async () => {
    const runner = createFakeCommandRunner({
      'system.uptime': { stdout: 'custom\n', exitCode: 0 },
    });

    const result = await runner.run('system.uptime', {});

    expect(result.stdout).toBe('custom\n');
    expect(result.exitCode).toBe(0);
    expect(runner.calls).toEqual([{ key: 'system.uptime', args: {} }]);
  });

  it('does not record a rejected call', async () => {
    const runner = createFakeCommandRunner();
    await expect(runner.run('missing', {})).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
    });
    expect(runner.calls).toEqual([]);
  });
});
