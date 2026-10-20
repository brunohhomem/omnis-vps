import { Buffer } from 'node:buffer';
import type { ToolContext, ToolDef } from '../../core/tool';
import { AppError } from '../../core/errors';
import { withAudit } from '../../core/with-audit';
import type { AppDeps } from '../../deps';

const MAX_RESULT_BYTES = 100 * 1024;
const TRUNCATION_NOTICE = '\n[truncated: result exceeded 100KB]';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export async function runTool(
  deps: AppDeps,
  tool: ToolDef,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const parsed = tool.input.parse(input);
    const value = tool.destructive
      ? await withAudit(
          deps.audit,
          { actor: ctx.actor, source: 'mcp' },
          { action: tool.name, params: parsed },
          () => tool.handler(parsed, ctx),
        )
      : await runRead(deps, tool, parsed, ctx);
    return { content: [{ type: 'text', text: encodeResult(value) }] };
  } catch (error) {
    if (error instanceof AppError) {
      return errorResult(error.code, error.message);
    }
    deps.logger.error({ err: error, tool: tool.name }, 'mcp tool failed');
    return errorResult('INTERNAL_ERROR', 'Internal server error');
  }
}

async function runRead(
  deps: AppDeps,
  tool: ToolDef,
  input: ReturnType<ToolDef['input']['parse']>,
  ctx: ToolContext,
): Promise<unknown> {
  deps.logger.debug({ tool: tool.name }, 'mcp read tool');
  return tool.handler(input, ctx);
}

function encodeResult(value: unknown): string {
  const text = JSON.stringify(value) ?? 'null';
  if (Buffer.byteLength(text) <= MAX_RESULT_BYTES) return text;
  const buffer = Buffer.from(text);
  let end = MAX_RESULT_BYTES;
  while (end > 0 && (buffer[end]! & 0b1100_0000) === 0b1000_0000) end -= 1;
  return `${buffer.subarray(0, end).toString('utf8')}${TRUNCATION_NOTICE}`;
}

function errorResult(code: string, message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ code, message }) }],
  };
}
