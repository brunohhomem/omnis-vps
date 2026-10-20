import { SystemSnapshotSchema } from '@omnis/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { createAdapters } from '../../src/infra';
import { createFakeSystemAdapter } from '../../src/infra/system/system.fake';
import { TEST_SECRET_KEY } from '../helpers/secret';

const REAL_REQUIRES_LINUX =
  'OMNIS_MODE=real exige Linux; use OMNIS_MODE=fake no desenvolvimento';

describe('fake system adapter', () => {
  it('is higher at 21h than at 4h', async () => {
    const evening = await averageCpu(21);
    const dawn = await averageCpu(4);
    expect(evening).toBeGreaterThan(dawn);
  });

  it('repeats the same sequence for the same seed', async () => {
    const first = await series(11);
    const second = await series(11);
    const other = await series(12);

    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
    for (const snapshot of first) {
      SystemSnapshotSchema.parse(snapshot);
    }
  });

  it('grows the disk as the clock advances', async () => {
    const early = await createFakeSystemAdapter({
      seed: 1,
      now: () => new Date(2026, 0, 1, 12, 0, 0),
    }).readSnapshot();
    const later = await createFakeSystemAdapter({
      seed: 1,
      now: () => new Date(2026, 0, 11, 12, 0, 0),
    }).readSnapshot();

    expect(later.disks[0]?.freeBytes).toBeLessThan(
      early.disks[0]?.freeBytes ?? 0,
    );
    expect(later.disks[0]?.totalBytes).toBe(100 * 1024 ** 3);
    expect(later.mem.totalBytes).toBe(8 * 1024 ** 3);
  });

  it('rejects real mode outside Linux', () => {
    if (process.platform === 'linux') return;
    const config = loadConfig({
      OMNIS_MODE: 'real',
      OMNIS_SECRET_KEY: TEST_SECRET_KEY,
    });
    expect(() => createAdapters(config, { info() {} })).toThrow(
      REAL_REQUIRES_LINUX,
    );
  });
});

async function averageCpu(hour: number): Promise<number> {
  const adapter = createFakeSystemAdapter({
    seed: 7,
    now: () => new Date(2026, 5, 15, hour, 30, 0),
  });
  let sum = 0;
  for (let i = 0; i < 20; i += 1) {
    sum += (await adapter.readSnapshot()).cpu.usagePct;
  }
  return sum / 20;
}

async function series(seed: number) {
  const adapter = createFakeSystemAdapter({
    seed,
    now: () => new Date(2026, 5, 15, 21, 0, 0),
  });
  return [
    await adapter.readSnapshot(),
    await adapter.readSnapshot(),
    await adapter.readSnapshot(),
  ];
}
