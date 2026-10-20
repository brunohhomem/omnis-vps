import type { ZodType } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client';
import { settings } from '../db/schema/settings';

export function createSettingsService(deps: { db: AppDatabase }) {
  return {
    get<T>(key: string, schema: ZodType<T>): T | null {
      const row = deps.db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .get();
      if (!row) return null;
      return schema.parse(JSON.parse(row.value));
    },

    set(key: string, value: unknown): void {
      const stored = JSON.stringify(value);
      const updatedAt = Date.now();
      deps.db
        .insert(settings)
        .values({ key, value: stored, updatedAt })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: stored, updatedAt },
        })
        .run();
    },

    delete(key: string): void {
      deps.db.delete(settings).where(eq(settings.key, key)).run();
    },
  };
}

export type SettingsService = ReturnType<typeof createSettingsService>;
