import { z } from 'zod';

export const SHARED_SMOKE = 'shared-ok' as const;
export const SmokeSchema = z.object({ message: z.string() });
