import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { paginated, PaginationQuerySchema } from './pagination';

const ItemSchema = z.object({ id: z.string() });

describe('PaginationQuerySchema', () => {
  it('applies the default limit', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ limit: 50 });
  });

  it('coerces a numeric string', () => {
    expect(PaginationQuerySchema.parse({ limit: '25' })).toEqual({ limit: 25 });
  });

  it('rejects limit above 500', () => {
    expect(PaginationQuerySchema.safeParse({ limit: 501 }).success).toBe(false);
  });
});

describe('paginated', () => {
  const schema = paginated(ItemSchema);

  it('accepts a valid page', () => {
    expect(schema.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });

  it('rejects a page without nextCursor', () => {
    expect(schema.safeParse({ items: [{ id: 'a' }] }).success).toBe(false);
  });
});
