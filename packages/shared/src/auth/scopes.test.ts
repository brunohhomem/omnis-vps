import { describe, expect, it } from 'vitest';

import { hasScope, type Scope } from './scopes';

const cases: Array<[granted: Scope, required: Scope, allowed: boolean]> = [
  ['read', 'read', true],
  ['read', 'ops', false],
  ['read', 'admin', false],
  ['ops', 'read', true],
  ['ops', 'ops', true],
  ['ops', 'admin', false],
  ['admin', 'read', true],
  ['admin', 'ops', true],
  ['admin', 'admin', true],
];

describe('hasScope', () => {
  for (const [granted, required, allowed] of cases) {
    it(`${granted} → ${required} = ${allowed}`, () => {
      expect(hasScope(granted, required)).toBe(allowed);
    });
  }
});
