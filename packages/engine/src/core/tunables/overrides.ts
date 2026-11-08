/**
 * The serialisable override shape stored in a save. Only overridden keys are stored, sorted by key
 * so that the same overrides always serialise to the same JSON.
 */

import { z } from 'zod';
import type { TunableRawValue } from './define';

/** Per-save tunable overrides: tunable key to the value that replaces its default. */
export type TunableOverrides = Readonly<Record<string, TunableRawValue>>;

/**
 * Structural schema for the overrides part of a save. It only checks the shape (string keys,
 * number, boolean or string values); whether each value suits its tunable is checked by
 * `validateOverrides`, which drops and reports bad entries instead of failing the whole load.
 */
export const tunableOverridesSchema = z.record(
  z.string(),
  z.union([z.number(), z.boolean(), z.string()]),
);

/** Returns a frozen copy of the overrides with its keys in sorted order. */
export function sortOverrides(overrides: TunableOverrides): TunableOverrides {
  const sorted: Record<string, TunableRawValue> = {};
  for (const key of Object.keys(overrides).sort()) {
    const value = overrides[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return Object.freeze(sorted);
}
