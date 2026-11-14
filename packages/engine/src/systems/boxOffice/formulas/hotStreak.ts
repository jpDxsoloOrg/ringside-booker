/**
 * Hot streak (EVT6-11): a run of good shows sells more tickets than the same shows spread out.
 *
 * The promotion's recent shows are walked oldest first. Each show scoring at or above
 * `boxOffice.streak.goodScore` adds `perShow` to the bonus, up to `cap`; a show below it breaks
 * the streak, and the bonus then fades by `fadePerShow` a show instead of vanishing. A new streak
 * builds on whatever is left of the last one. The streak sits on top of recent form: recent form is
 * the average of the window (and can take people away), the streak only rewards good shows in a
 * row. Design: docs/design/box-office.md#hot-streak.
 */

import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const HOT_STREAK_DOC_REF = 'box-office.md#hot-streak';

export interface HotStreakInputs {
  /** The scores of the counted recent shows, oldest first (`countedRecentShows`). */
  readonly scores: readonly number[];
}

/** Where a walk through the scores ends up. */
export interface HotStreakState {
  /** Good shows in a row at the end, 0 when the last show broke the streak. */
  readonly run: number;
  /** The bonus when the current run started, or when the streak last broke. */
  readonly startBonus: number;
  /** Shows below the good score since the streak broke (0 while a run is going). */
  readonly sinceBreak: number;
  /** The bonus now, 0..cap. */
  readonly bonus: number;
}

/** Walks the scores oldest first. Plain numbers; the traced lines are built from the result. */
export function hotStreakState(
  scores: readonly number[],
  tunables: EngineTunables,
): HotStreakState {
  const good = tunables.get('boxOffice.streak.goodScore');
  const perShow = tunables.get('boxOffice.streak.perShow');
  const cap = tunables.get('boxOffice.streak.cap');
  const fade = tunables.get('boxOffice.streak.fadePerShow');
  let run = 0;
  let sinceBreak = 0;
  let bonus = 0;
  let startBonus = 0;
  for (const score of scores) {
    if (score >= good) {
      if (run === 0) {
        startBonus = bonus;
      }
      run += 1;
      sinceBreak = 0;
      bonus = Math.min(cap, bonus + perShow);
    } else {
      if (run > 0 || sinceBreak === 0) {
        startBonus = bonus;
      }
      run = 0;
      sinceBreak += 1;
      bonus = Math.max(0, bonus - fade);
    }
  }
  return { run, startBonus, sinceBreak, bonus };
}

/** "3 good shows in a row" or "1 good show in a row". */
export function streakRunText(run: number): string {
  return `${String(run)} good ${run === 1 ? 'show' : 'shows'} in a row`;
}

/** The hot-streak multiplier on the crowd, 1..1 + cap. Deterministic: no rolls. */
export function computeHotStreak(
  inputs: HotStreakInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Hot streak',
    constantOf('No streak', 1, 'A multiplier of 1 leaves the crowd as it is'),
    { unit: 'multiplier', docRef: HOT_STREAK_DOC_REF },
  );
  const state = hotStreakState(inputs.scores, tunables);
  const good = formatNumber(tunables.get('boxOffice.streak.goodScore'));
  if (state.run > 0) {
    const bonus = startCalc(
      'Streak bonus',
      inputOf(`${streakRunText(state.run)} (${good} or better)`, state.run, undefined, 'count'),
      { unit: 'ratio' },
    );
    bonus.multiply(
      'Crowd added per good show',
      bonus.tunable(tunables, 'boxOffice.streak.perShow', 'Crowd added per good show'),
    );
    if (state.startBonus > 0) {
      bonus.add('Left from an earlier streak', state.startBonus);
    }
    bonus.min(
      'Largest streak bonus',
      bonus.tunable(tunables, 'boxOffice.streak.cap', 'Largest streak bonus'),
    );
    calc.add(streakRunText(state.run), bonus.done());
    return calc.done();
  }
  if (state.startBonus > 0) {
    const fading = startCalc(
      'Streak bonus fading',
      inputOf('Streak bonus when it broke', state.startBonus, undefined, 'ratio'),
      { unit: 'ratio' },
    );
    const lost = startCalc(
      'Faded since',
      inputOf(
        `${String(state.sinceBreak)} ${state.sinceBreak === 1 ? 'show' : 'shows'} below ${good} since`,
        state.sinceBreak,
        undefined,
        'count',
      ),
      { unit: 'ratio' },
    );
    lost.multiply(
      'Fades per show',
      lost.tunable(tunables, 'boxOffice.streak.fadePerShow', 'Fades per show'),
    );
    fading.subtract('Faded since', lost.done());
    fading.max('Never below 0', constantOf('Gone', 0, 'A faded streak adds nothing'));
    calc.add('Streak broken, fading', fading.done());
    return calc.done();
  }
  calc.note(`No hot streak: a show scoring ${good} or better starts one`);
  return calc.done();
}
