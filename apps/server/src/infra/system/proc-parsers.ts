export type CpuTimes = {
  idle: number;
  total: number;
};

export type NetCounters = Record<string, { rxBytes: number; txBytes: number }>;

export type NetRate = {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
};

const IGNORED_IFACE = /^(lo|veth.*|br-.*|docker.*)$/;

export function parseCpuTimes(stat: string): CpuTimes {
  const line = stat.split('\n').find((entry) => entry.startsWith('cpu '));
  if (line === undefined) {
    throw new Error('missing aggregate cpu line in /proc/stat');
  }

  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  const user = fields[0] ?? 0;
  const nice = fields[1] ?? 0;
  const system = fields[2] ?? 0;
  const idle = fields[3] ?? 0;
  const iowait = fields[4] ?? 0;
  const irq = fields[5] ?? 0;
  const softirq = fields[6] ?? 0;
  const steal = fields[7] ?? 0;
  const counters = [user, nice, system, idle, iowait, irq, softirq, steal];
  if (!counters.every(Number.isFinite)) {
    throw new Error('invalid cpu counters in /proc/stat');
  }

  // guest and guest_nice are already included in user and nice.
  const idleAll = idle + iowait;
  const total = user + nice + system + idleAll + irq + softirq + steal;
  return { idle: idleAll, total };
}

export function cpuUsagePct(previous: CpuTimes, current: CpuTimes): number {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) return 0;
  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

export function parseLoadavg(text: string): {
  m1: number;
  m5: number;
  m15: number;
} {
  const [m1, m5, m15] = text.trim().split(/\s+/).map(Number);
  if (![m1, m5, m15].every((value) => Number.isFinite(value))) {
    throw new Error('invalid /proc/loadavg');
  }
  return { m1: m1 ?? 0, m5: m5 ?? 0, m15: m15 ?? 0 };
}

export function parseMeminfo(text: string): {
  totalBytes: number;
  availableBytes: number;
  usedPct: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
} {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z]+):\s+(\d+)\s+kB\s*$/.exec(line.trim());
    if (!match) continue;
    values.set(match[1] ?? '', Number(match[2]) * 1024);
  }

  const totalBytes = requiredKiB(values, 'MemTotal');
  const availableBytes = requiredKiB(values, 'MemAvailable');
  const swapTotalBytes = values.get('SwapTotal') ?? 0;
  const swapFreeBytes = values.get('SwapFree') ?? 0;
  const usedPct =
    totalBytes === 0 ? 0 : ((totalBytes - availableBytes) / totalBytes) * 100;

  return {
    totalBytes,
    availableBytes,
    usedPct,
    swapTotalBytes,
    swapUsedBytes: Math.max(0, swapTotalBytes - swapFreeBytes),
  };
}

export function parseNetDev(text: string): NetCounters {
  const counters: NetCounters = {};
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const iface = line.slice(0, colon).trim();
    if (iface.length === 0 || IGNORED_IFACE.test(iface)) continue;
    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/);
    const rxBytes = Number(fields[0]);
    const txBytes = Number(fields[8]);
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    counters[iface] = { rxBytes, txBytes };
  }
  return counters;
}

export function netRates(
  previous: NetCounters,
  current: NetCounters,
  elapsedSec: number,
): NetRate[] {
  return Object.keys(current).map((iface) => {
    const now = current[iface];
    const before = previous[iface];
    if (!now || !before || elapsedSec <= 0) {
      return { iface, rxBytesPerSec: 0, txBytesPerSec: 0 };
    }
    return {
      iface,
      rxBytesPerSec: bytesPerSec(now.rxBytes, before.rxBytes, elapsedSec),
      txBytesPerSec: bytesPerSec(now.txBytes, before.txBytes, elapsedSec),
    };
  });
}

export function parseUptime(text: string): number {
  const uptimeSec = Number(text.trim().split(/\s+/)[0]);
  if (!Number.isFinite(uptimeSec) || uptimeSec < 0) {
    throw new Error('invalid /proc/uptime');
  }
  return uptimeSec;
}

export function clampPct(value: number): number {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function requiredKiB(values: Map<string, number>, key: string): number {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`missing ${key} in /proc/meminfo`);
  }
  return value;
}

function bytesPerSec(
  current: number,
  previous: number,
  elapsedSec: number,
): number {
  const delta = current - previous;
  if (delta <= 0) return 0;
  return delta / elapsedSec;
}
