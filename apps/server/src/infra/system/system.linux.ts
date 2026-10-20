import { readFile, statfs } from 'node:fs/promises';
import type { SystemSnapshot } from '@omnis/shared';
import { AppError } from '../../core/errors';
import {
  clampPct,
  cpuUsagePct,
  netRates,
  parseCpuTimes,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseUptime,
  type CpuTimes,
  type NetCounters,
} from './proc-parsers';
import type { SystemAdapter } from './system.adapter';

const FIRST_SAMPLE_MS = 500;

type Sample = {
  at: number;
  cpu: CpuTimes;
  net: NetCounters;
  load: ReturnType<typeof parseLoadavg>;
  mem: ReturnType<typeof parseMeminfo>;
  uptimeSec: number;
};

export function createLinuxSystemAdapter(
  mounts: readonly string[],
): SystemAdapter {
  let previous: Pick<Sample, 'at' | 'cpu' | 'net'> | undefined;

  return {
    async readSnapshot(): Promise<SystemSnapshot> {
      const first = await readSample();
      let baseline = previous;
      let current = first;
      if (baseline === undefined) {
        await sleep(FIRST_SAMPLE_MS);
        current = await readSample();
        baseline = first;
      }
      previous = { at: current.at, cpu: current.cpu, net: current.net };

      const elapsedSec = (current.at - baseline.at) / 1000;
      const disks = await Promise.all(mounts.map((mount) => readDisk(mount)));

      return {
        ts: new Date(current.at).toISOString(),
        cpu: {
          usagePct: clampPct(cpuUsagePct(baseline.cpu, current.cpu)),
        },
        load: current.load,
        mem: {
          ...current.mem,
          usedPct: clampPct(current.mem.usedPct),
        },
        disks,
        net: netRates(baseline.net, current.net, elapsedSec),
        uptimeSec: current.uptimeSec,
      };
    },
  };
}

async function readSample(): Promise<Sample> {
  const [stat, loadavg, meminfo, netDev, uptime] = await Promise.all([
    readProc('stat'),
    readProc('loadavg'),
    readProc('meminfo'),
    readProc('net/dev'),
    readProc('uptime'),
  ]);

  return {
    at: Date.now(),
    cpu: parseCpuTimes(stat),
    net: parseNetDev(netDev),
    load: parseLoadavg(loadavg),
    mem: parseMeminfo(meminfo),
    uptimeSec: parseUptime(uptime),
  };
}

async function readProc(name: string): Promise<string> {
  try {
    return await readFile(`/proc/${name}`, 'utf8');
  } catch (error) {
    throw new AppError(
      'ADAPTER_UNAVAILABLE',
      `Failed to read /proc/${name}`,
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function readDisk(
  mount: string,
): Promise<SystemSnapshot['disks'][number]> {
  try {
    const stats = await statfs(mount);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = (stats.blocks - stats.bfree) * stats.bsize;
    const capacity = usedBytes + freeBytes;
    const usedPct = capacity === 0 ? 0 : (usedBytes / capacity) * 100;
    return {
      mount,
      totalBytes,
      freeBytes,
      usedPct: clampPct(usedPct),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      'ADAPTER_UNAVAILABLE',
      `Failed to stat mount ${mount}`,
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
