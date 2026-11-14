/**
 * Starting prestige: what a newly created title is worth on day one.
 *
 * Design: docs/design/titles.md#starting-prestige. The tier sets a base
 * (`titles.startPrestige.<tier>`), and the promotion's own prestige moves it: a share
 * (`titles.startPrestige.promotionWeight`) of how far the promotion sits above or below
 * `titles.startPrestige.promotionAnchor`. The result is kept within 0..100 and rounded. No
 * randomness.
 */

import { startCalc } from '../../../core/trace/calc';
import { inputOf, traced } from '../../../core/trace/helpers';
import { tunableNode } from '../../../core/trace/tunable-node';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { TITLE_TIER_LABELS, type TitleTier } from '../tiers';

export const STARTING_PRESTIGE_DOC_REF = 'docs/design/titles.md#starting-prestige';

export interface StartingPrestigeInputs {
  /** The tier the player (or a rival) picked when creating the title. */
  readonly tier: TitleTier;
  /** The promotion's prestige on the day, 0..100. */
  readonly promotionPrestige: number;
}

export interface StartingPrestigeDeps {
  readonly tunables: EngineTunables;
}

const TIER_KEYS = {
  world: 'titles.startPrestige.world',
  secondary: 'titles.startPrestige.secondary',
  specialty: 'titles.startPrestige.specialty',
} as const satisfies Readonly<Record<TitleTier, string>>;

/** `round(clamp(base(tier) + (promotionPrestige − anchor) × weight, 0, 100))`. */
export function startingPrestige(
  inputs: StartingPrestigeInputs,
  deps: StartingPrestigeDeps,
): Traced<number> {
  const stature = startCalc(
    'Promotion stature',
    inputOf('Promotion prestige', inputs.promotionPrestige),
    { unit: 'points' },
  );
  stature
    .subtract(
      'No adjustment at',
      stature.tunable(deps.tunables, 'titles.startPrestige.promotionAnchor', 'No adjustment at'),
    )
    .multiply(
      'Share that counts',
      stature.tunable(deps.tunables, 'titles.startPrestige.promotionWeight', 'Share that counts'),
    );

  const key = TIER_KEYS[inputs.tier];
  const label = `${TITLE_TIER_LABELS[inputs.tier]} base`;
  const base = traced(deps.tunables.get(key), tunableNode(deps.tunables, key, label));
  return startCalc('Starting prestige', base, {
    unit: 'points',
    docRef: STARTING_PRESTIGE_DOC_REF,
  })
    .add('Promotion stature', stature.done())
    .clamp(0, 100)
    .round('round')
    .done();
}
