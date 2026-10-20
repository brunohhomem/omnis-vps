import { z } from 'zod';

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

export const IdSchema = z.string().min(1);

export type Id = z.infer<typeof IdSchema>;

export const ConfirmSchema = z
  .literal(true)
  .describe('Ações destrutivas exigem confirmação explícita.');

export type Confirm = z.infer<typeof ConfirmSchema>;
