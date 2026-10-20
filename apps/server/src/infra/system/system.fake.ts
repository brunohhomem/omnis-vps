import type { SystemSnapshot } from '@omnis/shared';
import type { SystemAdapter } from './system.adapter';

const GIB = 1024 ** 3;
const DAY_MS = 86_400_000;
const DISK_EPOCH_MS = Date.UTC(2026, 0, 1);
const BOOT_MS = Date.UTC(2024, 0, 1);
const DISK_GROWTH_PER_MS = (200 * 1024 ** 2) / DAY_MS;

export type FakeSystemOptions = {
  seed?: number;
  now?: () => Date;
};

export function createFakeSystemAdapter(
  options: FakeSystemOptions = {},
): SystemAdapter {
  const now = options.now ?? (() => new Date());
  const rng = createRng(options.seed ?? 1);

  return {
    async readSnapshot(): Promise<SystemSnapshot> {
      const at = now();
      const factor = dailyFactor(at.getHours());
      const cpu = clamp(8 + factor * 50 + jitter(rng, 2.5), 0, 100);
      const m1 = Math.max(0, 0.05 + factor * 1.3 + jitter(rng, 0.04));
      const m5 = Math.max(0, 0.05 + factor * 1.05 + jitter(rng, 0.03));
      const m15 = Math.max(0, 0.05 + factor * 0.8 + jitter(rng, 0.02));
      const memUsedPct = clamp(40 + factor * 25 + jitter(rng, 1), 0, 100);
      const swapFraction = clamp(
        0.02 + factor * 0.08 + jitter(rng, 0.005),
        0,
        1,
      );
      const rxBytesPerSec = Math.max(
        0,
        50_000 + factor * 1_500_000 + jitter(rng, 5_000),
      );
      const txBytesPerSec = Math.max(
        0,
        20_000 + factor * 400_000 + jitter(rng, 2_000),
      );

      const totalBytes = 8 * GIB;
      const swapTotalBytes = 2 * GIB;
      const diskTotalBytes = 100 * GIB;
      const elapsedMs = Math.max(0, at.getTime() - DISK_EPOCH_MS);
      const diskUsedBytes = Math.min(
        Math.round(diskTotalBytes * 0.9),
        Math.round(40 * GIB + elapsedMs * DISK_GROWTH_PER_MS),
      );

      return {
        ts: at.toISOString(),
        cpu: { usagePct: cpu },
        load: { m1, m5, m15 },
        mem: {
          totalBytes,
          availableBytes: Math.round(totalBytes * (1 - memUsedPct / 100)),
          usedPct: memUsedPct,
          swapTotalBytes,
          swapUsedBytes: Math.round(swapTotalBytes * swapFraction),
        },
        disks: [
          {
            mount: '/',
            totalBytes: diskTotalBytes,
            freeBytes: diskTotalBytes - diskUsedBytes,
            usedPct: (diskUsedBytes / diskTotalBytes) * 100,
          },
        ],
        net: [{ iface: 'eth0', rxBytesPerSec, txBytesPerSec }],
        uptimeSec: Math.max(0, (at.getTime() - BOOT_MS) / 1000),
      };
    },
  };
}

function dailyFactor(hour: number): number {
  const angle = ((hour - 21) / 24) * Math.PI * 2;
  return (Math.cos(angle) + 1) / 2;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rng: () => number, amplitude: number): number {
  return (rng() * 2 - 1) * amplitude;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
