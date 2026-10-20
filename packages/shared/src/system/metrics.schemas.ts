import { z } from 'zod';
import { IsoDateTimeSchema } from '../common/primitives';

const BytesSchema = z.number().nonnegative();
const PctSchema = z.number().min(0).max(100);

export const SystemSnapshotSchema = z.object({
  ts: IsoDateTimeSchema,
  cpu: z.object({
    usagePct: PctSchema,
  }),
  load: z.object({
    m1: z.number().nonnegative(),
    m5: z.number().nonnegative(),
    m15: z.number().nonnegative(),
  }),
  mem: z.object({
    totalBytes: BytesSchema,
    availableBytes: BytesSchema,
    usedPct: PctSchema,
    swapTotalBytes: BytesSchema,
    swapUsedBytes: BytesSchema,
  }),
  disks: z.array(
    z.object({
      mount: z.string(),
      totalBytes: BytesSchema,
      freeBytes: BytesSchema,
      usedPct: PctSchema,
    }),
  ),
  net: z.array(
    z.object({
      iface: z.string(),
      rxBytesPerSec: z.number().nonnegative(),
      txBytesPerSec: z.number().nonnegative(),
    }),
  ),
  uptimeSec: z.number().nonnegative(),
});

export type SystemSnapshot = z.infer<typeof SystemSnapshotSchema>;
