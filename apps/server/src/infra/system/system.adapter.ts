import type { SystemSnapshot } from '@omnis/shared';

export interface SystemAdapter {
  readSnapshot(): Promise<SystemSnapshot>;
}
