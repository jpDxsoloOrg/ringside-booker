/**
 * The spacing steps a layout helper accepts: the `N` in the `--space-N` tokens (0.25rem per step).
 * Layout gaps are always one of these, never a raw length, so spacing stays on the scale.
 */
export const SPACE_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export type SpaceStep = (typeof SPACE_STEPS)[number];
