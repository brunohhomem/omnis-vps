import { createSystemService } from '../system/system.service';
import type { AppDeps } from '../../deps';
import type { ToolDef } from '../../core/tool';
import { createAuditTools } from '../audit/audit.tools';
import { createSystemTools } from '../system/system.tools';
import type { z } from 'zod';

const TOOL_NAME = /^[a-z]+(_[a-z]+)+$/;

export function createToolRegistry(deps: AppDeps): ToolDef[] {
  const tools = [
    ...createSystemTools({ system: createSystemService(deps) }),
    ...createAuditTools({ audit: deps.audit }),
  ];
  validateTools(tools);
  return tools;
}

export function validateTools(tools: ToolDef[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name: ${tool.name}`);
    }
    seen.add(tool.name);
    if (!TOOL_NAME.test(tool.name)) {
      throw new Error(`Invalid MCP tool name: ${tool.name}`);
    }
    if (tool.destructive && !hasConfirm(tool)) {
      throw new Error(`Destructive MCP tool ${tool.name} requires confirm`);
    }
    if (tool.destructive && tool.scope === 'read') {
      throw new Error(
        `Destructive MCP tool ${tool.name} cannot use scope read`,
      );
    }
  }
}

function hasConfirm(tool: ToolDef): boolean {
  const confirm = tool.input.shape.confirm;
  if (confirm === undefined || !('safeParse' in confirm)) return false;
  const schema = confirm as z.ZodType;
  return (
    schema.safeParse(true).success &&
    !schema.safeParse(false).success &&
    !schema.safeParse(undefined).success
  );
}
