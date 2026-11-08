import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '@ringside/engine';
import { BUNDLED_ENGINE_VERSION } from './engineVersion';

describe('web app engine link', () => {
  it('resolves the engine workspace package', () => {
    expect(BUNDLED_ENGINE_VERSION).toBe(ENGINE_VERSION);
  });
});
