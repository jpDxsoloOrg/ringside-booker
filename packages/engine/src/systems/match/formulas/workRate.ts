/**
 * Work rate: the in-ring half of a match rating.
 *
 * Each worker's performance first meets the stamina the slot's duration class asks for (D-10: a
 * main event is a real test of stamina and psychology; an opener isn't). The sides and then the
 * match combine those with the side aggregate. The match's leader must have the psychology to
 * lead a match that long. The duration class then sets how far the result may stray from 50, the
 * match type scales it, and a night-to-night roll moves it a little.
 *
 * Popularity and momentum never enter work rate: they belong to the crowd side.
 *
 * Design: docs/design/match-rating.md#work-rate.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { rollNormal } from '../../../core/rng/rolls';
import type { RngStream } from '../../../core/rng/registry';
import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { MatchTypeDef } from '../../../model/catalogs';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { sideAggregate, type SideAggregateMember } from './sideAggregate';

export const WORK_RATE_DOC_REF = 'match-rating.md#work-rate';

export interface WorkRateWorker {
  id: string;
  name: string;
  /** The worker's in-ring performance (`workerPerformance` on the in-ring axis). */
  performance: Traced<number>;
  stamina: number;
}

export interface WorkRateSide {
  /** The stored side number, 0-based. Screens read side `n` as "Side n + 1". */
  side: number;
  members: readonly WorkRateWorker[];
}

/** Whoever leads the match: the worker with the highest psychology, ties by id. */
export interface MatchLeader {
  id: string;
  name: string;
  psychology: number;
}

export interface WorkRateInputs {
  durationClass: DurationClass;
  /** The slot and class as the player reads them, such as "Main event (long)". */
  durationLabel: string;
  sides: readonly WorkRateSide[];
  /** Everyone working the match, across every side. */
  workerCount: number;
  leader: MatchLeader;
  matchType: Pick<MatchTypeDef, 'name' | 'workRateFactor'>;
}

export const NO_VARIANCE_NOTE = 'No variance roll';
export const VARIANCE_LABEL = 'Night-to-night variance';
export const ACROSS_SIDES_LABEL = 'Across sides';

/** Work rate is floored at 0 here; MTCH1-04's soft compression and the rater's clamp cap it. */
const WORK_RATE_FLOOR = 0;
/** The centre the showcase spread stretches around: the middle of the 0..100 scale. */
const SCALE_MIDDLE = 50;
/** The stamina need is set for a singles match: two workers sharing the load. */
const SINGLES_WORKERS = 2;

const STAMINA_NEED_KEYS = {
  short: 'match.workRate.staminaNeed.short',
  standard: 'match.workRate.staminaNeed.standard',
  long: 'match.workRate.staminaNeed.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

const PSYCHOLOGY_NEED_KEYS = {
  short: 'match.workRate.psychologyNeed.short',
  standard: 'match.workRate.psychologyNeed.standard',
  long: 'match.workRate.psychologyNeed.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

const SPREAD_KEYS = {
  short: 'match.workRate.spread.short',
  standard: 'match.workRate.spread.standard',
  long: 'match.workRate.spread.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

/** "−6" with a real minus sign; "0" stays "0". */
function minus(value: number): string {
  return value === 0 ? '0' : `−${formatNumber(value)}`;
}

/** "Side 1" for stored side 0. */
export function sideLabel(side: number): string {
  return `Side ${String(side + 1)}`;
}

/** The match leader among `candidates`: highest psychology, ties by id ascending. */
export function matchLeaderOf(candidates: readonly MatchLeader[]): MatchLeader {
  let leader: MatchLeader | undefined;
  for (const candidate of candidates) {
    if (
      leader === undefined ||
      candidate.psychology > leader.psychology ||
      (candidate.psychology === leader.psychology && candidate.id < leader.id)
    ) {
      leader = candidate;
    }
  }
  if (leader === undefined) {
    throw new RangeError('matchLeaderOf: there must be at least one candidate');
  }
  return leader;
}

/**
 * Step 1 for one worker: `performance − max(0, need − stamina) × staminaPenaltyPerPoint`, where
 * `need = staminaNeed.<class> × (2 ÷ max(2, workerCount)) ^ sharedLoadExponent`.
 */
function afterStaminaCheck(
  worker: WorkRateWorker,
  inputs: WorkRateInputs,
  tunables: EngineTunables,
): Traced<number> {
  const classLabel = DURATION_CLASS_LABELS[inputs.durationClass];
  const sharers = Math.max(SINGLES_WORKERS, inputs.workerCount);
  const penalty = startCalc(`Stamina penalty for ${worker.name}`, 0, {
    unit: 'points',
    docRef: WORK_RATE_DOC_REF,
    startLabel: 'Nothing needed yet',
  });
  penalty.add(
    `${classLabel} match need`,
    penalty.tunable(tunables, STAMINA_NEED_KEYS[inputs.durationClass], 'Stamina need'),
  );
  const exponent = penalty.tunable(tunables, 'match.workRate.sharedLoadExponent', 'Shared load');
  penalty
    .multiply(
      `Shared by ${String(inputs.workerCount)}: (2 ÷ ${String(sharers)}) ^ ${formatNumber(exponent)}`,
      (SINGLES_WORKERS / sharers) ** exponent,
    )
    .subtract(`${worker.name}'s stamina`, worker.stamina)
    .max('No shortfall below 0', 0)
    .multiply(
      'Penalty per point short',
      penalty.tunable(tunables, 'match.workRate.staminaPenaltyPerPoint', 'Stamina penalty'),
    );
  const cost = penalty.done();
  const verdict =
    cost.value > 0
      ? `stamina check failed for ${worker.name}, ${minus(cost.value)}`
      : `stamina check passed for ${worker.name}`;
  return startCalc(`${worker.name} after the stamina check`, worker.performance, { unit: 'points' })
    .subtract(`${inputs.durationLabel}: ${verdict}`, cost)
    .done();
}

/** Step 3: `max(0, psychologyNeed.<class> − leader psychology) × psychologyPenaltyPerPoint`. */
function psychologyPenalty(
  inputs: WorkRateInputs,
  tunables: EngineTunables,
): { cost: Traced<number>; line: string } {
  const classWord = DURATION_CLASS_LABELS[inputs.durationClass].toLowerCase();
  const { leader } = inputs;
  const calc = startCalc('Psychology penalty', 0, {
    unit: 'points',
    docRef: WORK_RATE_DOC_REF,
    startLabel: 'Nothing needed yet',
  });
  const need = calc.tunable(
    tunables,
    PSYCHOLOGY_NEED_KEYS[inputs.durationClass],
    'Psychology need',
  );
  calc
    .add(`Psychology a ${classWord} match needs`, need)
    .subtract(`${leader.name}'s psychology`, leader.psychology)
    .max('No shortfall below 0', 0)
    .multiply(
      'Penalty per point short',
      calc.tunable(tunables, 'match.workRate.psychologyPenaltyPerPoint', 'Psychology penalty'),
    );
  const cost = calc.done();
  const best = `${formatNumber(leader.psychology)} (${leader.name}), needs ${formatNumber(need)}`;
  const line =
    leader.psychology < need
      ? `Nobody to lead a ${classWord} match: best psychology ${best}`
      : `${leader.name} can lead a ${classWord} match: psychology ${best}`;
  return { cost, line };
}

/**
 * The match's work rate, floored at 0 and not capped:
 *
 * 1. each worker's performance minus their stamina shortfall × rate;
 * 2. the side aggregate per side (`match.side.depthDecay`), then across sides
 *    (`match.sides.depthDecay`);
 * 3. minus the leader's psychology shortfall × rate;
 * 4. `50 + (value − 50) × spread.<class>`;
 * 5. × the match type's work rate factor;
 * 6. plus a normal roll with sd `match.workRate.varianceSd` when `deps.rng` is given;
 * 7. at least 0.
 *
 * @throws InvalidArgumentError when there are no sides or `workerCount` is below 1; RangeError
 *   (from the side aggregate) for an empty side.
 */
export function workRate(
  inputs: WorkRateInputs,
  deps: { tunables: EngineTunables; rng?: RngStream },
): Traced<number> {
  if (inputs.sides.length === 0) {
    throw new InvalidArgumentError('workRate', 'sides', inputs.sides.length, 'at least one side');
  }
  if (!Number.isInteger(inputs.workerCount) || inputs.workerCount < 1) {
    throw new InvalidArgumentError(
      'workRate',
      'workerCount',
      inputs.workerCount,
      'a whole number of at least 1',
    );
  }
  const { tunables } = deps;

  const sideValues: SideAggregateMember[] = inputs.sides.map((side) => ({
    id: String(side.side).padStart(2, '0'),
    name: sideLabel(side.side),
    value: sideAggregate(
      {
        label: sideLabel(side.side),
        members: side.members.map((worker) => ({
          id: worker.id,
          name: worker.name,
          value: afterStaminaCheck(worker, inputs, tunables),
        })),
        decayKey: 'match.side.depthDecay',
      },
      { tunables },
    ),
  }));
  const acrossSides = sideAggregate(
    { label: ACROSS_SIDES_LABEL, members: sideValues, decayKey: 'match.sides.depthDecay' },
    { tunables },
  );

  const calc = startCalc('Work rate', acrossSides, { unit: 'points', docRef: WORK_RATE_DOC_REF });
  calc.note(`Duration: ${inputs.durationLabel}`);

  const psychology = psychologyPenalty(inputs, tunables);
  calc.subtract(psychology.line, psychology.cost);

  const middle = constantOf(
    'Middle of the scale',
    SCALE_MIDDLE,
    'The spread stretches a match away from the middle of the 0–100 scale',
  );
  calc
    .subtract('From the middle', middle)
    .multiply(
      `${DURATION_CLASS_LABELS[inputs.durationClass]} match spread`,
      calc.tunable(tunables, SPREAD_KEYS[inputs.durationClass], 'Showcase spread'),
    )
    .add('Back to the scale', middle)
    .multiply(
      `${inputs.matchType.name} work rate factor`,
      constantOf(
        `${inputs.matchType.name} work rate factor`,
        inputs.matchType.workRateFactor,
        `Set by the ${inputs.matchType.name} match type`,
      ),
    );

  if (deps.rng === undefined) {
    calc.note(NO_VARIANCE_NOTE);
  } else {
    const sd = calc.tunable(tunables, 'match.workRate.varianceSd', 'Variance spread');
    const variance = rollNormal(deps.rng, 0, sd, VARIANCE_LABEL);
    calc.roll(variance.roll).add(VARIANCE_LABEL, variance.value);
  }

  return calc.max('Never below 0', WORK_RATE_FLOOR).done();
}
