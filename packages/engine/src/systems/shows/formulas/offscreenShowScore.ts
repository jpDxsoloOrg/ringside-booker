/**
 * Off-screen show score: a score for a computer-controlled show nobody booked in detail.
 *
 * Until AIP4 lets rivals book real cards, a rival show has no card to run. It still needs a score,
 * so it gets one from the promotion's prestige, its popularity where the show runs, the show's
 * size and a random night-to-night swing. Every part is traced (D-01: rival shows keep full
 * traces). It never applies to a human-controlled show.
 *
 * Design: docs/design/show-night.md#off-screen-score.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollFloat } from '../../../core/rng/rolls';
import { startCalc, type Traced } from '../../../core/trace';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { SHOW_SCORE_MAX, SHOW_SCORE_MIN } from './showScore';

export const OFFSCREEN_SHOW_SCORE_DOC_REF = 'docs/design/show-night.md#off-screen-score';

export interface OffscreenShowScoreInputs {
  showName: string;
  importance: EventImportance;
  /** The promotion's prestige, 0 to 100. */
  prestige: number;
  /** The promotion's popularity in the show's region, 0 to 100 (0 where it has none). */
  popularityInRegion: number;
  /** The show's region as the player reads it. */
  regionName: string;
}

const IMPORTANCE_KEYS = {
  house: 'shows.offscreen.importance.house',
  minor: 'shows.offscreen.importance.minor',
  regular: 'shows.offscreen.importance.regular',
  major: 'shows.offscreen.importance.major',
  flagship: 'shows.offscreen.importance.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

/** The importance line as the player reads it. */
const IMPORTANCE_LINES: Readonly<Record<EventImportance, string>> = {
  house: 'House show',
  minor: 'Minor show',
  regular: 'Regular show',
  major: 'Major show',
  flagship: 'Flagship show',
};

/**
 * `base + prestigeWeight × prestige + popularityWeight × popularity + importance points + swing`,
 * with the swing rolled between −spread and +spread on `deps.rng`, kept within 0..100 and rounded.
 *
 * The swing is always rolled, even at spread 0, so every call draws exactly once and changing a
 * tunable never shifts the stream.
 */
export function offscreenShowScore(
  inputs: OffscreenShowScoreInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  const calc = startCalc('Show score (card not booked in detail)', 0, {
    unit: 'points',
    docRef: OFFSCREEN_SHOW_SCORE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  calc.add('Starting score', calc.tunable(deps.tunables, 'shows.offscreen.base', 'Starting score'));

  const prestige = startCalc('Promotion prestige', inputs.prestige, {
    unit: 'points',
    startLabel: 'Prestige',
  });
  prestige.multiply(
    'Prestige weight',
    prestige.tunable(deps.tunables, 'shows.offscreen.prestigeWeight', 'Prestige weight'),
  );
  calc.add('Promotion prestige', prestige.done());

  const popularityLine = `Popularity in ${inputs.regionName}`;
  const popularity = startCalc(popularityLine, inputs.popularityInRegion, {
    unit: 'points',
    startLabel: 'Popularity',
  });
  popularity.multiply(
    'Popularity weight',
    popularity.tunable(deps.tunables, 'shows.offscreen.popularityWeight', 'Popularity weight'),
  );
  calc.add(popularityLine, popularity.done());

  const importanceLine = IMPORTANCE_LINES[inputs.importance];
  calc.add(
    importanceLine,
    calc.tunable(deps.tunables, IMPORTANCE_KEYS[inputs.importance], importanceLine),
  );

  const spread = calc.tunable(deps.tunables, 'shows.offscreen.spread', 'Largest swing');
  // `0 - spread`, not `-spread`: at spread 0 that is 0, not -0, so the record stays plain JSON.
  const swing = rollFloat(deps.rng, 0 - spread, spread, 'Night-to-night swing');
  calc.roll(swing.roll);
  if (spread === 0) {
    calc.note('No randomness (0)');
  }
  return calc
    .add('Night-to-night swing', swing.value)
    .clamp(SHOW_SCORE_MIN, SHOW_SCORE_MAX)
    .round('round')
    .done();
}
