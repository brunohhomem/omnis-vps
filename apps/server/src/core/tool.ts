import type { Actor, Scope } from '@omnis/shared';
import type { ZodObject, ZodRawShape } from 'zod';
import type { z } from 'zod';
import type { Principal } from './principal';

export type ToolContext = {
  principal: Principal;
  actor: Actor;
  source: 'mcp';
};

export type ToolDef<I extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>> =
  {
    name: string;
    description: string;
    scope: Scope;
    destructive: boolean;
    input: I;
    handler: (input: z.infer<I>, ctx: ToolContext) => Promise<unknown>;
  };
