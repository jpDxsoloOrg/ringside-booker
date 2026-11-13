/**
 * The momentum half of a match's aftermath (MTCH3-02): how much one result moves a competitor's
 * momentum with the promotion. Category `Aftermath`. Every value is in momentum points (the
 * employment's −100..100 scale) unless its unit says otherwise; 0 removes its effect.
 *
 * Kept in its own file beside the popularity tunables so the two halves can change apart; both are
 * merged into `ALL_TUNABLES` in `systems/tunables.ts`.
 *
 * The weekly drift back toward a resting point (MTCH3-07) lives here too: `weeklyDrift`,
 * `activeDriftShare` and `driftTarget`, documented under docs/design/match-aftermath.md#momentum-drift.
 *
 * Design: docs/design/match-aftermath.md#momentum-gain.
 */

import { defineTunables } from '../../../core/tunables/define';

export const AFTERMATH_TUNABLES_CATEGORY = 'Aftermath';
export const MOMENTUM_GAIN_TUNABLES_DOC = 'match-aftermath.md#momentum-gain';
export const MOMENTUM_DRIFT_TUNABLES_DOC = 'match-aftermath.md#momentum-drift';

function momentumNumber(
  defaultValue: number,
  range: { min: number; max: number; step: number },
  unit: 'points' | 'ratio',
  description: string,
) {
  return {
    kind: 'number',
    default: defaultValue,
    min: range.min,
    max: range.max,
    step: range.step,
    unit,
    category: AFTERMATH_TUNABLES_CATEGORY,
    description,
    docRef: MOMENTUM_GAIN_TUNABLES_DOC,
  } as const;
}

const POINTS = { min: 0, max: 50, step: 0.5 } as const;
const PER_POINT = { min: 0, max: 2, step: 0.05 } as const;

export const momentumTunables = defineTunables({
  'match.momentum.winBase': momentumNumber(5, POINTS, 'points', 'Momentum a win is worth'),
  'match.momentum.winGapPerPoint': momentumNumber(
    0.2,
    PER_POINT,
    'ratio',
    'Extra momentum per point the beaten opponent was hotter',
  ),
  'match.momentum.winMax': momentumNumber(15, POINTS, 'points', 'Most momentum one win can give'),
  'match.momentum.lossBase': momentumNumber(5, POINTS, 'points', 'Momentum a loss costs'),
  'match.momentum.lossGapPerPoint': momentumNumber(
    0.2,
    PER_POINT,
    'ratio',
    'Extra momentum lost per point the winner was colder',
  ),
  'match.momentum.lossMax': momentumNumber(15, POINTS, 'points', 'Most momentum one loss can cost'),
  'match.momentum.draw': momentumNumber(2, POINTS, 'points', 'Momentum a draw costs'),
  'match.momentum.multiSideWinPerExtraSide': momentumNumber(
    1,
    { min: 0, max: 10, step: 0.5 },
    'points',
    'Extra momentum for winning, per side beyond two',
  ),
  'match.momentum.multiSideLossShare': momentumNumber(
    0.35,
    { min: 0, max: 1, step: 0.05 },
    'ratio',
    'Smallest share of a loss kept in a match with many sides',
  ),
  'match.momentum.greatMatchFrom': momentumNumber(
    85,
    { min: 0, max: 100, step: 1 },
    'points',
    'Segment score from which a match counts as great',
  ),
  'match.momentum.greatMatchBonus': momentumNumber(
    2,
    { min: 0, max: 20, step: 0.5 },
    'points',
    'Momentum everyone in a great match gains',
  ),
  'match.momentum.maxPerSegment': momentumNumber(
    15,
    POINTS,
    'points',
    'Most momentum one match can give or take',
  ),
  // MTCH3-07. 0.12 takes an idle +100 under +20 in 13 weeks (0.88^13 ≈ 0.19), about three months.
  'match.momentum.weeklyDrift': {
    ...momentumNumber(
      0.12,
      { min: 0, max: 1, step: 0.01 },
      'ratio',
      'Share of the way back to the resting point momentum moves each week (0 turns it off)',
    ),
    docRef: MOMENTUM_DRIFT_TUNABLES_DOC,
  },
  // MTCH3-07. At 0.5 a worker winning once a week holds about +78 (5 × 0.94 ÷ 0.06).
  'match.momentum.activeDriftShare': {
    ...momentumNumber(
      0.5,
      { min: 0, max: 1, step: 0.05 },
      'ratio',
      'Share of the weekly cooling off a worker who wrestled that week still gets',
    ),
    docRef: MOMENTUM_DRIFT_TUNABLES_DOC,
  },
  'match.momentum.driftTarget': {
    ...momentumNumber(
      0,
      { min: -100, max: 100, step: 1 },
      'points',
      'The momentum everyone drifts back toward each week',
    ),
    docRef: MOMENTUM_DRIFT_TUNABLES_DOC,
  },
});
