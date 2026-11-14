/**
 * Beat worker value: what one person brings to one group of a beat (MTCH5-02).
 *
 * Every stat in the group's mix is adjusted first (popularity share, morale, momentum, and for the
 * talking stats a manager standing in at a reduced share); only then is the best value picked.
 * Because the pick comes after the adjustments, morale and momentum really change it: a
 * demoralised talker can lose out to their own manager. A small seeded roll for the night follows.
 *
 * Design: docs/design/angle-rating.md#beat-worker-value.
 */

import { InvalidArgumentError } from '../../../../core/errors';
import { rollInt } from '../../../../core/rng/rolls';
import type { RngStream } from '../../../../core/rng/registry';
import {
  constantOf,
  inputOf,
  mapTraced,
  startCalc,
  startDecision,
  type Traced,
} from '../../../../core/trace';
import type { EngineTunables } from '../../../tunables';
import { formatNumber } from '../../../world/people/labels';
import { NO_MOMENTUM_NOTE } from '../../rating/common';
import { BEAT_STAT_LABELS, isTalkingStat, type BeatStat } from '../beatStats';
import { pickBeatStat, type BeatStatCandidate } from '../pickBeatStat';

export const BEAT_WORKER_VALUE_DOC_REF = 'angle-rating.md#beat-worker-value';

export const NOT_YOUR_WORKER_NOTE = 'Not your worker: morale and momentum treated as neutral';
export const STAT_NOISE_LABEL = 'Performance on the night';
export const NO_NOISE_BRANCH = 'No noise (tunable at 0)';
export const BEST_STAT_LABEL = 'Best stat';

/** A manager who may talk for the person, with their own values and morale. */
export interface BeatManagerInputs {
  name: string;
  values: Partial<Record<BeatStat, number>>;
  /** -100..100. */
  morale: number;
}

export interface BeatWorkerValueInputs {
  personName: string;
  /** The group's stat mix, in the beat's order (earlier wins a tie). */
  stats: readonly BeatStat[];
  /** 0..100 per stat; a missing stat counts as 0. `popularity` is popularity in the show region. */
  values: Partial<Record<BeatStat, number>>;
  /** -100..100. */
  morale: number;
  /** -100..100, null before the first appearance. */
  momentum: number | null;
  manager: BeatManagerInputs | null;
  /** The catalog's `managerCanStandIn` for this group. */
  managerCanStandIn: boolean;
  /**
   * False for a rival's worker: the caller passes neutral morale and momentum, and the formula
   * treats them as neutral whatever it is given, so a preview never shows a rival's morale.
   */
  isViewersWorker: boolean;
}

/** A decision option: a stat, or a stat the manager talks for. */
type CandidateOption = BeatStat | `${BeatStat}:manager`;

const FACTOR_REASON = 'Worked out under Best stat';

const VALUE_MIN = 0;
const VALUE_MAX = 100;

const fullValue = (): Traced<number> =>
  constantOf('Full value', 1, 'A factor of 1 leaves a stat as it is');
const scaleOf = (what: 'Morale' | 'Momentum'): Traced<number> =>
  constantOf(`${what} scale`, 100, `${what} runs from -100 to 100`);
const zeroLine = (): Traced<number> =>
  constantOf('Zero', 0, 'Only the part on the far side of 0 counts');

function percent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

/** 1 - moralePenaltyMax x max(0, -morale) / 100, as "Low morale" added to a full factor. */
function moraleFactor(label: string, morale: number, tunables: EngineTunables): Traced<number> {
  const penalty = startCalc('Low morale', inputOf('Morale', morale));
  penalty
    .min('Only morale below 0 counts', zeroLine())
    .divide('Morale scale', scaleOf('Morale'))
    .multiply(
      'Most low morale can take off',
      penalty.tunable(tunables, 'match.angle.moralePenaltyMax'),
    );
  return startCalc(label, fullValue(), { unit: 'multiplier' })
    .add('Low morale', penalty.done())
    .done();
}

/**
 * 1 + momentumBonusMax x max(0, momentum) / 100 - momentumPenaltyMax x max(0, -momentum) / 100.
 * Null momentum counts as 0 with a note.
 */
function momentumFactor(momentum: number | null, tunables: EngineTunables): Traced<number> {
  const value = momentum ?? 0;
  const bonus = startCalc('Good momentum', inputOf('Momentum', value));
  bonus
    .max('Only momentum above 0 counts', zeroLine())
    .divide('Momentum scale', scaleOf('Momentum'))
    .multiply(
      'Most good momentum can add',
      bonus.tunable(tunables, 'match.angle.momentumBonusMax'),
    );
  const penalty = startCalc('Poor momentum', inputOf('Momentum', value));
  penalty
    .min('Only momentum below 0 counts', zeroLine())
    .divide('Momentum scale', scaleOf('Momentum'))
    .multiply(
      'Most poor momentum can take off',
      penalty.tunable(tunables, 'match.angle.momentumPenaltyMax'),
    );
  const calc = startCalc('Momentum factor', fullValue(), { unit: 'multiplier' });
  if (momentum === null) {
    calc.note(NO_MOMENTUM_NOTE);
  }
  return calc.add('Good momentum', bonus.done()).add('Poor momentum', penalty.done()).done();
}

function managerOption(stat: BeatStat): CandidateOption {
  return `${stat}:manager`;
}

/**
 * The person's value in one beat group, 0..100: the best adjusted stat (or the manager's talking),
 * plus a roll of up to `match.angle.statNoise` points either way, kept between 0 and 100. Titled
 * with the person's name.
 *
 * @throws InvalidArgumentError when the stat mix is empty.
 */
export function beatWorkerValue(
  inputs: BeatWorkerValueInputs,
  deps: { tunables: EngineTunables; rng: RngStream },
): Traced<number> {
  if (inputs.stats.length === 0) {
    throw new InvalidArgumentError('beatWorkerValue', 'stats', 0, 'at least one stat');
  }
  const { tunables } = deps;
  const neutral = !inputs.isViewersWorker;
  const morale = neutral ? 0 : inputs.morale;
  const momentum = neutral ? 0 : inputs.momentum;

  const decision = startDecision<CandidateOption>(BEST_STAT_LABEL, {
    docRef: BEAT_WORKER_VALUE_DOC_REF,
  });
  const ownMorale = moraleFactor('Morale factor', morale, tunables);
  const ownMomentum = momentumFactor(momentum, tunables);
  decision.include('Morale factor', ownMorale).include('Momentum factor', ownMomentum);

  const manager = inputs.managerCanStandIn ? inputs.manager : null;
  const standsIn = manager !== null && inputs.stats.some((stat) => isTalkingStat(stat));
  const managerMorale =
    manager !== null && standsIn
      ? moraleFactor(`Morale factor: ${manager.name}`, neutral ? 0 : manager.morale, tunables)
      : null;
  if (managerMorale !== null) {
    decision.include(managerMorale.trace.label, managerMorale);
  }
  const managerShare = standsIn
    ? decision.tunable(tunables, 'match.angle.managerShare', "Manager's share")
    : 0;
  const popularityShare = inputs.stats.includes('popularity')
    ? decision.tunable(tunables, 'match.angle.popularityStatShare', 'Popularity counts for')
    : 1;

  const candidates: BeatStatCandidate[] = [];
  /** Every option considered, for the summary line. */
  const entries: { option: CandidateOption; label: string; value: number }[] = [];
  for (const stat of inputs.stats) {
    const label = BEAT_STAT_LABELS[stat];
    const raw = inputs.values[stat] ?? 0;
    const shared = stat === 'popularity' ? raw * popularityShare : raw;
    const own = shared * ownMorale.value * ownMomentum.value;
    const shareText = stat === 'popularity' ? ` × ${percent(popularityShare)}` : '';
    decision.consider(
      stat,
      own,
      `${label} ${formatNumber(raw)}${shareText} × morale ${formatNumber(ownMorale.value)} × momentum ${formatNumber(ownMomentum.value)} = ${formatNumber(own)}`,
    );
    entries.push({ option: stat, label, value: own });
    let managerValue: number | null = null;
    if (manager !== null && managerMorale !== null && isTalkingStat(stat)) {
      const managerRaw = manager.values[stat] ?? 0;
      managerValue = managerRaw * managerShare * managerMorale.value;
      const moraleText =
        managerMorale.value === 1 ? '' : ` × morale ${formatNumber(managerMorale.value)}`;
      decision.consider(
        managerOption(stat),
        managerValue,
        `Manager ${manager.name} stands in on ${label}: ${formatNumber(managerRaw)} × ${percent(managerShare)}${moraleText} = ${formatNumber(managerValue)}`,
      );
      entries.push({
        option: managerOption(stat),
        label: `${label} via manager`,
        value: managerValue,
      });
    }
    candidates.push({ stat, own, managerValue });
  }

  const picked = pickBeatStat(candidates);
  const pickedLabel = picked.viaManager
    ? `${BEAT_STAT_LABELS[picked.stat]} via manager ${manager?.name ?? ''}`
    : BEAT_STAT_LABELS[picked.stat];
  const pickedOption = picked.viaManager ? managerOption(picked.stat) : picked.stat;
  const others = entries
    .filter((entry) => entry.option !== pickedOption)
    .map((entry) => `${entry.label} ${formatNumber(entry.value)}`);
  const summary = `${BEST_STAT_LABEL}: ${pickedLabel} ${formatNumber(picked.value)}${
    others.length === 0 ? '' : ` (${others.join(', ')})`
  }`;
  const chosen = decision.choose(pickedOption, summary);

  // Replays the winner's arithmetic from its raw value, in the same order as the candidate above.
  const viaManager = picked.viaManager && manager !== null && managerMorale !== null;
  const rawWinner = viaManager
    ? (manager.values[picked.stat] ?? 0)
    : (inputs.values[picked.stat] ?? 0);
  const calc = startCalc(
    inputs.personName,
    mapTraced(chosen, summary, () => rawWinner),
    { unit: 'points', docRef: BEAT_WORKER_VALUE_DOC_REF },
  );
  if (viaManager) {
    calc
      .note(`Manager ${manager.name} stands in on ${BEAT_STAT_LABELS[picked.stat]}`)
      .multiply("Manager's share", calc.tunable(tunables, 'match.angle.managerShare'))
      .multiply(`Morale of ${manager.name}`, managerMorale.value, FACTOR_REASON);
  } else {
    if (picked.stat === 'popularity') {
      calc.multiply(
        'Popularity counts for',
        calc.tunable(tunables, 'match.angle.popularityStatShare'),
      );
    }
    calc
      .multiply('Morale', ownMorale.value, FACTOR_REASON)
      .multiply('Momentum', ownMomentum.value, FACTOR_REASON);
  }
  if (neutral) {
    calc.note(NOT_YOUR_WORKER_NOTE);
  }

  const spread = calc.tunable(tunables, 'match.angle.statNoise', 'Most the night can move it');
  if (spread === 0) {
    calc.branch(NO_NOISE_BRANCH, true);
  } else {
    const noise = rollInt(deps.rng, -spread, spread, STAT_NOISE_LABEL);
    calc.roll(noise.roll).add(STAT_NOISE_LABEL, noise.value);
  }
  return calc.clamp(VALUE_MIN, VALUE_MAX).done();
}
