/**
 * Hand-made physical toll rows for the PhysicalTollTable gallery entry (MTCH4-05): a fresh worker,
 * an exhausted one, an injured one, one hurt past the per-match limit, a "Limited by potential"
 * learning trace and a Run x100 summary. The traces are small stand-ins built with the engine's
 * own trace builders, so the Why? panels read like the real ones without minutes or ceilings.
 */
import type {
  BodyPart,
  InjuryOutcome,
  PersonId,
  PhysicalPreviewSummary,
  PhysicalPreviewWorker,
  Traced,
} from '@ringside/engine';
import { BODY_PART_LABELS, BODY_PARTS, parseId, startCalc, startDecision } from '@ringside/engine';

const PART_WEIGHTS: Readonly<Record<BodyPart, number>> = {
  head: 0.6,
  neck: 0.8,
  back: 1.2,
  arms: 0.9,
  torso: 1,
  legs: 1.1,
};

const WEIGHT_TOTAL = BODY_PARTS.reduce((total, part) => total + PART_WEIGHTS[part], 0);

function person(serial: number): PersonId {
  return parseId('person', `per_${String(serial).padStart(10, '0')}`);
}

function fatigueGain(name: string, value: number): Traced<number> {
  return startCalc(`Fatigue gain for ${name}`, 10, {
    unit: 'points',
    startLabel: 'Long duration class',
  })
    .multiply('Main event', 1.2, 'A big match takes more out of everyone')
    .multiply('Stamina relief', value / 12)
    .done();
}

function wearLoad(name: string, load: number): Traced<number> {
  return startCalc(`Wear for ${name}`, load, {
    unit: 'points',
    startLabel: 'Long duration class',
  }).done();
}

function wearByPart(load: number): Record<BodyPart, Traced<number>> {
  const part = (bodyPart: BodyPart): Traced<number> =>
    startCalc(`${BODY_PART_LABELS[bodyPart]} wear`, load, { unit: 'points' })
      .multiply(`${BODY_PART_LABELS[bodyPart]} weight`, PART_WEIGHTS[bodyPart])
      .done();
  return {
    head: part('head'),
    neck: part('neck'),
    back: part('back'),
    arms: part('arms'),
    torso: part('torso'),
    legs: part('legs'),
  };
}

function learning(name: string, value: number, limited: boolean): Traced<number> {
  const calc = startCalc(`Learning in this match for ${name}`, value * 2, {
    unit: 'attribute',
    startLabel: 'Long duration class',
  });
  if (limited) {
    calc.branch('Limited by potential', true).multiply('Limited by potential', 0.5);
  }
  return calc.done();
}

function injuryChance(name: string, fatigueIn: number, chance: number): Traced<number> {
  return startCalc(`Injury chance for ${name}`, 0.003, { unit: 'probability' })
    .add(
      'Fatigue risk',
      startCalc('Fatigue by the end of the match', fatigueIn, {
        unit: 'points',
        startLabel: `${name}'s fatigue going in`,
      })
        .multiply('Per point of fatigue', 0.0001)
        .done(),
    )
    .multiply('Long duration class', chance / (0.003 + fatigueIn * 0.0001))
    .done();
}

function roll(name: string, outcome: InjuryOutcome, reason: string): Traced<InjuryOutcome> {
  return startDecision<InjuryOutcome>(`Injured in this match? (${name})`).choose(outcome, reason);
}

interface WorkerSpec {
  readonly serial: number;
  readonly name: string;
  readonly side: number;
  readonly safety: number;
  readonly fatigueIn: number;
  readonly gain: number;
  readonly load: number;
  readonly learned: number;
  readonly limited?: boolean;
  readonly chance: number;
  readonly outcome?: 'injured' | 'ignored' | 'unhurt';
  readonly whatIf?: boolean;
}

function worker(spec: WorkerSpec): PhysicalPreviewWorker {
  const id = person(spec.serial);
  const gain = fatigueGain(spec.name, spec.gain);
  const load = wearLoad(spec.name, spec.load);
  const byPart = wearByPart(spec.load);
  const outcome = spec.outcome ?? 'unhurt';
  const injured = outcome === 'injured';
  const conditionAfter = {
    head: 92,
    neck: 90,
    back: 84,
    arms: 88,
    torso: 89,
    legs: 86,
  };
  const learned = learning(spec.name, spec.learned, spec.limited === true);
  return {
    personId: id,
    name: spec.name,
    side: spec.side,
    safety: spec.safety,
    fatigueBefore: spec.fatigueIn,
    fatigueGain: gain,
    fatigueAfter: Math.min(100, spec.fatigueIn + gain.value),
    wearLoad: load,
    wearByPart: byPart,
    conditionAfter,
    worstPartAfter: { part: 'back', value: 84 },
    learning: learned,
    learningByAttribute: {
      ringwork: learned,
      psychology: learned,
      safety: learned,
      stamina: learned,
    },
    injuryChance: injuryChance(spec.name, spec.fatigueIn, spec.chance),
    injury: {
      injured,
      ignoredOverLimit: outcome === 'ignored',
      bodyPartHint: injured ? 'back' : null,
      roll: roll(
        spec.name,
        outcome === 'injured' ? 'injured' : 'unhurt',
        outcome === 'injured'
          ? 'The roll came up'
          : outcome === 'ignored'
            ? 'The roll came up, but this match already had its most injuries'
            : 'The roll missed',
      ),
    },
    contributions: [],
    fatigueNow: spec.whatIf === true ? 20 : spec.fatigueIn,
    fatigueWhatIf: spec.whatIf === true,
    wearTotal: startCalc('Condition lost in this match', load, { unit: 'points' })
      .multiply('Spread over the body', WEIGHT_TOTAL, 'The body part weights added up')
      .done(),
  };
}

/** A fresh worker and an exhausted one (a lab what-if), nobody hurt. */
export function freshAndExhausted(): PhysicalPreviewWorker[] {
  return [
    worker({
      serial: 1,
      name: 'Ace Mercer',
      side: 0,
      safety: 72,
      fatigueIn: 8,
      gain: 14,
      load: 1.6,
      learned: 0.08,
      chance: 0.006,
    }),
    worker({
      serial: 2,
      name: 'Bartholomew "The Lighthouse" Vandermeer-Ashcombe',
      side: 1,
      safety: 38,
      fatigueIn: 100,
      gain: 15,
      load: 2.4,
      learned: 0.05,
      chance: 0.031,
      whatIf: true,
    }),
  ];
}

/** An injured worker, one hurt past the limit (ignored), and a learner held back by potential. */
export function injuredAndOverLimit(): PhysicalPreviewWorker[] {
  return [
    worker({
      serial: 3,
      name: 'Rhea Castillo',
      side: 0,
      safety: 41,
      fatigueIn: 64,
      gain: 18,
      load: 2.9,
      learned: 0.11,
      chance: 0.052,
      outcome: 'injured',
    }),
    worker({
      serial: 4,
      name: 'Kenji Arai',
      side: 1,
      safety: 55,
      fatigueIn: 70,
      gain: 17,
      load: 2.5,
      learned: 0.03,
      limited: true,
      chance: 0.044,
      outcome: 'ignored',
    }),
  ];
}

/** A Run x100 summary for the four workers above. */
export function runManySummary(): PhysicalPreviewSummary {
  return {
    runs: 100,
    injuredSegments: 6,
    injuriesPer100: 6,
    byPerson: [
      {
        personId: person(1),
        name: 'Ace Mercer',
        side: 0,
        injuries: 1,
        meanFatigueGain: 14.2,
        meanWearTotal: 9.8,
        meanLearning: 0.08,
      },
      {
        personId: person(2),
        name: 'Bartholomew "The Lighthouse" Vandermeer-Ashcombe',
        side: 1,
        injuries: 5,
        meanFatigueGain: 15.1,
        meanWearTotal: 13.6,
        meanLearning: 0.05,
      },
    ],
  };
}
