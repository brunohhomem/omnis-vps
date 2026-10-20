import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cpuUsagePct,
  netRates,
  parseCpuTimes,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseUptime,
} from '../../src/infra/system/proc-parsers';

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);

function fixture(name: string): string {
  return readFileSync(path.join(fixtures, name), 'utf8');
}

describe('proc parsers', () => {
  it('computes CPU usage from the aggregate line', () => {
    const previous = parseCpuTimes(fixture('proc-stat-a.txt'));
    const current = parseCpuTimes(fixture('proc-stat-b.txt'));

    expect(previous).toEqual({ idle: 8300, total: 10100 });
    expect(current).toEqual({ idle: 9000, total: 11450 });
    expect(cpuUsagePct(previous, current)).toBeCloseTo((650 / 1350) * 100, 5);
    expect(cpuUsagePct(current, current)).toBe(0);
  });

  it('reads load, memory and uptime', () => {
    expect(parseLoadavg(fixture('proc-loadavg.txt'))).toEqual({
      m1: 0.42,
      m5: 0.31,
      m15: 0.2,
    });
    expect(parseUptime(fixture('proc-uptime.txt'))).toBe(3600.5);
    expect(parseMeminfo(fixture('proc-meminfo.txt'))).toEqual({
      totalBytes: 8000000 * 1024,
      availableBytes: 5000000 * 1024,
      usedPct: 37.5,
      swapTotalBytes: 2000000 * 1024,
      swapUsedBytes: 500000 * 1024,
    });
  });

  it('requires MemAvailable', () => {
    expect(() => parseMeminfo('MemTotal: 1024 kB\nMemFree: 512 kB\n')).toThrow(
      /MemAvailable/,
    );
  });

  it('ignores lo, veth, bridge and docker interfaces', () => {
    const previous = parseNetDev(fixture('proc-net-a.txt'));
    const current = parseNetDev(fixture('proc-net-b.txt'));

    expect(Object.keys(previous).sort()).toEqual(['ens3', 'eth0']);
    expect(netRates(previous, current, 2)).toEqual([
      { iface: 'eth0', rxBytesPerSec: 1000, txBytesPerSec: 500 },
      { iface: 'ens3', rxBytesPerSec: 1000, txBytesPerSec: 500 },
    ]);
  });
});
