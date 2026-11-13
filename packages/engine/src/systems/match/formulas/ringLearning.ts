/**
 * Ring learning: how much of one attribute one worker picks up in one match (MTCH4-03).
 *
 * Small on purpose (hundredths of a point per match): the long career arc of growth and decline
 * belongs to WRK4; this is learning by doing, which MTCH4's result applier writes after each match.
 *
 * The hidden gate enters only as its label (`room`). The potential number and the ceilings never
 * become inputs, constants or notes here, so the Why? can say "Limited by potential" and nothing
 * more. The room factor is the last step before the clamp and nothing adds learning after it, so
 * no bonus can get past the gate.
 *
 * Design: docs/design/physical-toll.md#ring-learning.
 */

import { startCalc, traced, type Calc, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import { ATTRIBUTE_KEYS, type AttributeKey, type TraitKey } from '../../../model/entities/person';
import { ATTRIBUTE_LABELS } from '../../world/people/labels';
import type { EngineTunables } from '../../tunables';
import { PRODUCED_ATTRIBUTES, isTaughtAttribute } from '../physical/learning';
import type { LearningRoom } from '../physical/learningRoom';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';

export const RING_LEARNING_DOC_REF = 'physical-toll.md#ring-learning';

/** The fixed Why? line for a worker whose learning room is not open. Never carries a number. */
export const LIMITED_BY_POTENTIAL_LABEL = 'Limited by potential';

/** Someone else in the match, as the learning formula reads them for one attribute. */
export interface LearningPeer {
  readonly name: string;
  /** Their value in the attribute being learned. */
  readonly value: number;
  /** Holds the `teacher` trait. */
  readonly teacher: boolean;
}

/** The segment's producer, as the learning formula reads them. */
export interface LearningProducer {
  readonly name: string;
  readonly producing: number;
  /** Holds the `teacher` trait. */
  readonly teacher: boolean;
}

export interface RingLearningInputs {
  /** The worker's name, for the trace. */
  readonly name: string;
  readonly attribute: AttributeKey;
  /**
   * Whether a better worker or a teacher can teach this attribute. Defaults to the
   * `IN_MATCH_LEARNING` flag (stamina is practice only).
   */
  readonly taught?: boolean;
  readonly durationClass: DurationClass;
  /** The worker's own value in the attribute. */
  readonly value: number;
  readonly traits: readonly TraitKey[];
  /** The other competitors in the match, on any side. */
  readonly others: readonly LearningPeer[];
  /** The producer, when the segment has one who is not the worker. */
  readonly producer: LearningProducer | null;
  /** The worker's mentor, when they are on the same show. */
  readonly mentor: { readonly name: string } | null;
  /** The hidden gate's label (`learningRoom`); only the label ever enters the formula. */
  readonly room: LearningRoom;
}

const DURATION_KEYS = {
  short: 'match.learning.duration.short',
  standard: 'match.learning.duration.standard',
  long: 'match.learning.duration.long',
} as const;

const ROOM_KEYS = {
  slowing: 'match.learning.roomFactor.slowing',
  closed: 'match.learning.roomFactor.closed',
} as const;

/** The best other worker, when they are better by at least `match.learning.teachGap`. */
function betterWorker(inputs: RingLearningInputs, teachGap: number): LearningPeer | null {
  let best: LearningPeer | null = null;
  for (const peer of inputs.others) {
    if (peer.value - inputs.value < teachGap) {
      continue;
    }
    if (best === null || peer.value > best.value) {
      best = peer;
    }
  }
  return best;
}

/** `min(1 + teacherBonus × teachers, maxTeacherFactor)`. */
function teacherFactor(teachers: number, tunables: EngineTunables): Traced<number> {
  const bonusKey = 'match.learning.teacherBonus';
  const perTeacher = traced(tunables.get(bonusKey), tunableNode(tunables, bonusKey, 'Per teacher'));
  const bonus = startCalc('Teacher bonus', perTeacher, { unit: 'ratio' })
    .multiply(`${String(teachers)} ${teachers === 1 ? 'teacher' : 'teachers'}`, teachers)
    .done();
  const calc = startCalc('Teacher factor', 1, { unit: 'multiplier', startLabel: 'No teacher' });
  return calc
    .add('Teacher bonus', bonus)
    .min('Most teachers can add', calc.tunable(tunables, 'match.learning.maxTeacherFactor'))
    .done();
}

/** `1 + mentorBonus`. */
function mentorFactor(tunables: EngineTunables): Traced<number> {
  const calc = startCalc('Mentor factor', 1, { unit: 'multiplier', startLabel: 'No mentor' });
  return calc
    .add('Mentor bonus', calc.tunable(tunables, 'match.learning.mentorBonus', 'Mentor bonus'))
    .done();
}

function applyTaught(calc: Calc, inputs: RingLearningInputs, tunables: EngineTunables): void {
  const better = betterWorker(inputs, tunables.get('match.learning.teachGap'));
  if (better !== null) {
    calc.multiply(
      `Learned from a better worker: ${better.name}`,
      calc.tunable(tunables, 'match.learning.taughtFactor'),
    );
  }
  const teachers = [
    ...inputs.others.filter((peer) => peer.teacher).map((peer) => peer.name),
    ...(inputs.producer?.teacher === true ? [inputs.producer.name] : []),
  ];
  if (teachers.length > 0) {
    calc.multiply(
      `Worked with a teacher: ${teachers.join(', ')}`,
      teacherFactor(teachers.length, tunables),
    );
  }
}

/**
 * Ring skill one worker learns in one attribute in one match, in attribute points:
 *
 * `base × duration.<class> × taught (better worker) × min(1 + teacherBonus × teachers,
 * maxTeacherFactor) × producer (ring work and psychology) × fast/slow learner × (1 + mentorBonus)
 * × room factor`, kept within 0..`match.learning.maxPerSegment`. An untaught attribute (stamina)
 * skips the better-worker and teacher steps with the line "Learned by doing".
 */
export function computeRingLearning(
  inputs: RingLearningInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const attributeLabel = ATTRIBUTE_LABELS[inputs.attribute];
  const calc = startCalc(
    `${attributeLabel} learned by ${inputs.name}`,
    traced(
      tunables.get('match.learning.base'),
      tunableNode(tunables, 'match.learning.base', 'Learning in one match'),
    ),
    { unit: 'attribute', docRef: RING_LEARNING_DOC_REF },
  );

  calc.multiply(
    `${DURATION_CLASS_LABELS[inputs.durationClass]} duration class`,
    calc.tunable(tunables, DURATION_KEYS[inputs.durationClass]),
  );

  if (inputs.taught ?? isTaughtAttribute(inputs.attribute)) {
    applyTaught(calc, inputs, tunables);
  } else {
    calc.branch('Learned by doing', true);
  }

  const producer = inputs.producer;
  if (
    producer !== null &&
    PRODUCED_ATTRIBUTES.includes(inputs.attribute) &&
    producer.producing >= tunables.get('match.learning.producerMinSkill')
  ) {
    calc.multiply(
      `Produced by ${producer.name}`,
      calc.tunable(tunables, 'match.learning.producerFactor'),
    );
  }

  if (inputs.traits.includes('fastLearner')) {
    calc.multiply('Fast learner', calc.tunable(tunables, 'match.learning.fastLearnerFactor'));
  }
  if (inputs.traits.includes('slowLearner')) {
    calc.multiply('Slow learner', calc.tunable(tunables, 'match.learning.slowLearnerFactor'));
  }

  if (inputs.mentor !== null) {
    calc.multiply(`Mentor on the card: ${inputs.mentor.name}`, mentorFactor(tunables));
  }

  // The gate goes last, so nothing can add learning past it.
  if (inputs.room !== 'open') {
    calc.multiply(
      LIMITED_BY_POTENTIAL_LABEL,
      calc.tunable(tunables, ROOM_KEYS[inputs.room], LIMITED_BY_POTENTIAL_LABEL),
    );
  }

  return calc
    .clamp(
      0,
      calc.tunable(tunables, 'match.learning.maxPerSegment'),
      'Between 0 and the most one match can teach',
    )
    .done();
}

/** Thousandths: the finest step a learning gain is read to. */
const LEARNING_GAIN_SCALE = 1000;

/**
 * A learning gain as the game says it everywhere (the Match lab, the results page and the Why?
 * line): "+0.06" or "+0.004" (up to three decimals, since a match teaches hundredths of a point),
 * "+0" for none, and "less than +0.001" for a gain too small to show. Rounding it to two decimals
 * made most real gains read "+0.00".
 */
export function learningGainText(value: number): string {
  if (value <= 0) {
    return '+0';
  }
  const rounded = Math.round(value * LEARNING_GAIN_SCALE) / LEARNING_GAIN_SCALE;
  return rounded === 0 ? 'less than +0.001' : `+${String(rounded)}`;
}

/**
 * "Learning in this match": each attribute's learning added up, one line per attribute ("Ring work
 * +0.06") that opens to that attribute's own Why?.
 */
export function computeRingLearningTotal(
  perAttribute: Readonly<Partial<Record<AttributeKey, Traced<number>>>>,
): Traced<number> {
  const calc = startCalc('Learning in this match', 0, {
    unit: 'attribute',
    docRef: RING_LEARNING_DOC_REF,
    startLabel: 'Nothing yet',
  });
  for (const attribute of ATTRIBUTE_KEYS) {
    const learning = perAttribute[attribute];
    if (learning !== undefined) {
      calc.add(`${ATTRIBUTE_LABELS[attribute]} ${learningGainText(learning.value)}`, learning);
    }
  }
  return calc.done();
}
