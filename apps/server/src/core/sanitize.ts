const SENSITIVE_KEY = /pass|secret|token|key|cookie|authorization|content/i;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 5;
const TRUNCATED_SUFFIX = '…[truncado]';

export function sanitize(value: unknown, depth = 1): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (typeof value === 'string') return truncate(value);
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? '[REDACTED]'
      : sanitize(child, depth + 1);
  }
  return output;
}

function truncate(value: string): string {
  const chars = Array.from(value);
  if (chars.length <= MAX_STRING_LENGTH) return value;
  return chars.slice(0, MAX_STRING_LENGTH).join('') + TRUNCATED_SUFFIX;
}
