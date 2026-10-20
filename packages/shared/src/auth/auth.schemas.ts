import { z } from 'zod';
import { IsoDateTimeSchema } from '../common/primitives';
import { ScopeSchema } from './scopes';

export const LoginInputSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

export const MeOutputSchema = z.object({
  username: z.string(),
  authType: z.enum(['session', 'token']),
  scope: ScopeSchema,
});

export type MeOutput = z.infer<typeof MeOutputSchema>;

export const TokenCreateInputSchema = z.object({
  name: z.string().min(1).max(80),
  scope: ScopeSchema,
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export type TokenCreateInput = z.infer<typeof TokenCreateInputSchema>;

export const TokenCreateOutputSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  prefix: z.string(),
  token: z.string(),
  scope: ScopeSchema,
  createdAt: IsoDateTimeSchema,
  expiresAt: IsoDateTimeSchema.nullable(),
});

export type TokenCreateOutput = z.infer<typeof TokenCreateOutputSchema>;

export const TokenListItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  prefix: z.string(),
  scope: ScopeSchema,
  createdAt: IsoDateTimeSchema,
  lastUsedAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});

export type TokenListItem = z.infer<typeof TokenListItemSchema>;

export const TokenListOutputSchema = z.array(TokenListItemSchema);

export type TokenListOutput = z.infer<typeof TokenListOutputSchema>;
