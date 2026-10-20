import type { IncomingHttpHeaders } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function getClientIp(
  request: { ip: string; headers: IncomingHttpHeaders },
  config: { TRUST_CLOUDFLARE: boolean },
): string {
  if (config.TRUST_CLOUDFLARE && LOOPBACK.has(request.ip)) {
    const header = request.headers['cf-connecting-ip'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return request.ip;
}
