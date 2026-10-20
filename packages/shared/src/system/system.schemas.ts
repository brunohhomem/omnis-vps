import { z } from 'zod';

export const HealthOutputSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSec: z.number(),
  rssBytes: z.number(),
});

export type HealthOutput = z.infer<typeof HealthOutputSchema>;

export const OmnisModeSchema = z.enum(['real', 'fake']);

export type OmnisMode = z.infer<typeof OmnisModeSchema>;

export const SystemInfoOutputSchema = z.object({
  hostname: z.string(),
  platform: z.string(),
  kernel: z.string().optional(),
  cpuCount: z.number(),
  totalMemBytes: z.number(),
  nodeVersion: z.string(),
  omnisVersion: z.string(),
  mode: OmnisModeSchema,
});

export type SystemInfoOutput = z.infer<typeof SystemInfoOutputSchema>;
