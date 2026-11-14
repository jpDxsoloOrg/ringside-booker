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

const VALUE_MIN = 0;
const VALUE_MAX = 100;

const SCALE_REASONS = {
  Morale: 'Morale runs from -100 to 100',
  Momentum: 'Momentum runs from -100 to 100',
} as const;
const FULL_VALUE_REASON = 'A factor of 1 leaves a stat as it is';
const NEUTRAL_REASON = 'Not your worker: treated as neutral';

function percent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

/**
 * 1 - moralePenaltyMax × max(0, -morale) / 100. Morale 0 or above gives a plain factor of 1, so a
 * happy worker's trace stays one line long.
 */
function moraleFactor(
  label: string,
  morale: number,
  neutral: boolean,
  tunables: EngineTunables,
): Traced<number> {
  if (neutral) {
    return constantOf(label, 1, NEUTRAL_REASON);
  }
  if (morale >= 0) {
    return constantOf(label, 1, 'Morale is 0 or above, so it takes nothing off');
  }
  const calc = startCalc(label, inputOf('Morale', morale), { unit: 'multiplier' });
  return calc
    .divide('Morale scale', constantOf('Morale scale', 100, SCALE_REASONS.Morale))
    .multiply(
      'Most low morale can take off',
      calc.tunable(tunables, 'match.angle.moralePenaltyMax'),
    )
    .add('Full value', constantOf('Full value', 1, FULL_VALUE_REASON))
    .done();
}

/**
 * 1 + momentumBonusMax × max(0, momentum) / 100 - momentumPenaltyMax × max(0, -momentum) / 100.
 * Only one side can apply, so the factor reads the side that does; null and 0 give a plain 1.
 */
function momentumFactor(
  momentum: number | null,
  neutral: boolean,
  tunables: EngineTunables,
): Traced<number> {
  const label = 'Momentum factor';
  if (neutral) {
    return constantOf(label, 1, NEUTRAL_REASON);
  }
  if (momentum === null) {
    return constantOf(label, 1, NO_MOMENTUM_NOTE);
  }
  if (momentum === 0) {
    return constantOf(label, 1, 'Momentum is 0, so it adds and takes nothing');
  }
  const calc = startCalc(label, inputOf('Momentum', momentum), { unit: 'multiplier' });
  calc.divide('Momentum scale', constantOf('Momentum scale', 100, SCALE_REASONS.Momentum));
  if (momentum > 0) {
    calc.multiply(
      'Most good momentum can add',
      calc.tunable(tunables, 'match.angle.momentumBonusMax'),
    );
  } else {
    calc.multiply(
      'Most poor momentum can take off',
      calc.tunable(tunables, 'match.angle.momentumPenaltyMax'),
    );
  }
  return calc.add('Full value', constantOf('Full value', 1, FULL_VALUE_REASON)).done();
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

  const decision = startDecision<CandidateOption>(BEST_STAT_LABEL, {
    docRef: BEAT_WORKER_VALUE_DOC_REF,
  });
  const ownMorale = moraleFactor('Morale factor', inputs.morale, neutral, tunables);
  const ownMomentum = momentumFactor(inputs.momentum, neutral, tunables);

  const manager = inputs.managerCanStandIn ? inputs.manager : null;
  const managerMorale =
    manager !== null && inputs.stats.some((stat) => isTalkingStat(stat))
      ? moraleFactor(`Morale of ${manager.name}`, manager.morale, neutral, tunables)
      : null;
  // Read for the candidates; the winner's chain below records the read it uses.
  const managerShare = tunables.get('match.angle.managerShare');
  const popularityShare = tunables.get('match.angle.popularityStatShare');

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
  // The factors the winner's own chain does not use still explain the pick, so the decision
  // keeps them; the ones it uses sit under its steps.
  const viaManager = picked.viaManager && manager !== null && managerMorale !== null;
  if (viaManager) {
    decision.include('Morale factor', ownMorale).include('Momentum factor', ownMomentum);
  } else if (managerMorale !== null) {
    decision.include(managerMorale.trace.label, managerMorale);
  }
  const chosen = decision.choose(pickedOption, summary);

  // Replays the winner's arithmetic from its raw value, in the same order as the candidate above.
  const rawWinner = viaManager
    ? (manager.values[picked.stat] ?? 0)
    : (inputs.values[picked.stat] ?? 0);
  const calc = startCalc(
    inputs.personName,
    mapTraced(
      chosen,
      viaManager
        ? `${BEAT_STAT_LABELS[picked.stat]} of ${manager.name}`
        : BEAT_STAT_LABELS[picked.stat],
      () => rawWinner,
    ),
    { unit: 'points', docRef: BEAT_WORKER_VALUE_DOC_REF },
  );
  if (neutral) {
    calc.note(NOT_YOUR_WORKER_NOTE);
  } else if (inputs.momentum === null) {
    calc.note(NO_MOMENTUM_NOTE);
  }
  if (viaManager) {
    calc
      .note(`Manager ${manager.name} stands in on ${BEAT_STAT_LABELS[picked.stat]}`)
      .multiply("Manager's share", calc.tunable(tunables, 'match.angle.managerShare'))
      .multiply(managerMorale.trace.label, managerMorale);
  } else {
    if (picked.stat === 'popularity') {
      calc.multiply(
        'Popularity counts for',
        calc.tunable(tunables, 'match.angle.popularityStatShare'),
      );
    }
    calc.multiply('Morale', ownMorale).multiply('Momentum', ownMomentum);
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
