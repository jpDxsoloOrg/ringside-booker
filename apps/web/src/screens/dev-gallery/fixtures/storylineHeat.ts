/**
 * Stand-in storyline heat and payoff data for the gallery (CRTV4-05): a heat step's Why?, and
 * payoff plans for a hot story with a played finale, a cold one, one with too few segments and
 * one where a member has left.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type {
  PayoffPlan,
  PayoffPlanMember,
  StoredTraceEntry,
  TraceNode,
  TraceRef,
} from '@ringside/engine';

/** Where the gallery's heat step Why? is filed. */
export const GALLERY_HEAT_STEP_REF: TraceRef = {
  kind: 'storylines.heatStep',
  id: 'sty_gallery/seg_gallery',
};

const heatStepTrace: TraceNode = {
  kind: 'formula',
  label: "Heat after 'Main event'",
  value: 62,
  unit: 'points',
  children: [
    { kind: 'input', label: 'Heat before the segment', value: 54, unit: 'points' },
    { kind: 'input', label: 'Segment score: Ise vs Kuroe', value: 74, unit: 'points' },
    {
      kind: 'add',
      label: 'Pulled toward the segment score',
      value: 62,
      unit: 'points',
      operand: 8,
      before: 54,
      after: 62,
    },
  ],
};

/** The heat step as the trace store keeps a recent one. */
export const galleryHeatStepEntry: StoredTraceEntry = {
  ref: GALLERY_HEAT_STEP_REF,
  date: parseGameDate('2031-03-14'),
  seq: 1,
  trace: heatStepTrace,
  value: 62,
};

function points(label: string, value: number, reason: string): { value: number; trace: TraceNode } {
  return {
    value,
    trace: {
      kind: 'formula',
      label,
      value,
      unit: 'points',
      children: [{ kind: 'input', label: reason, value, unit: 'points' }],
    },
  };
}

function quality(value: number, heat: number): PayoffPlan['quality'] {
  return {
    value,
    trace: {
      kind: 'formula',
      label: 'Payoff strength',
      value,
      unit: 'ratio',
      children: [{ kind: 'input', label: 'Heat when it ended', value: heat, unit: 'points' }],
    },
  };
}

function outcome(pay: boolean): PayoffPlan['outcome'] {
  const value = pay ? 'pay' : 'noPayoff';
  return { value, trace: { kind: 'input', label: 'Does it pay off?', value } };
}

let nextPerson = 1;

function member(
  name: string,
  popularity: number,
  momentum: number,
  skippedReason: string | null = null,
): PayoffPlanMember {
  const personId = parseId('person', `per_00000009${String(nextPerson++).padStart(2, '0')}`);
  return {
    personId,
    name,
    employmentId: null,
    marketPopularity: skippedReason === null ? 55 : null,
    popularity: points(`Popularity payoff for ${name}`, popularity, 'Share of the payoff'),
    momentum: points(`Momentum payoff for ${name}`, momentum, 'Share of the payoff'),
    skippedReason,
  };
}

function plan(fields: {
  readonly name: string;
  readonly heat: number;
  readonly countedSegments: number;
  readonly finalePlayed: boolean;
  readonly quality: number;
  readonly members: readonly PayoffPlanMember[];
}): PayoffPlan {
  const eligible = fields.countedSegments >= 4;
  return {
    storylineId: parseId('storyline', 'sty_0000000901'),
    promotionId: parseId('promotion', 'pro_0000000901'),
    storylineName: fields.name,
    heat: fields.heat,
    countedSegments: fields.countedSegments,
    minSegments: 4,
    finalePlayed: fields.finalePlayed,
    eligible,
    outcome: outcome(eligible),
    quality: quality(eligible ? fields.quality : 0, fields.heat),
    members: fields.members,
    regionWeights: {},
  };
}

/** A hot story whose finale was played: everyone gains. */
export const hotPayoffPlan: PayoffPlan = plan({
  name: 'Ashfall Rivalry',
  heat: 86,
  countedSegments: 6,
  finalePlayed: true,
  quality: 1,
  members: [member('Ise', 3.4, 9), member('Kuroe', 2.1, 9)],
});

/** A story that went cold: everyone loses a little. */
export const coldPayoffPlan: PayoffPlan = plan({
  name: 'Harbour Grudge',
  heat: 22,
  countedSegments: 5,
  finalePlayed: false,
  quality: -0.7,
  members: [member('Marlowe', -1.6, -7), member('Petra Vale', -1.2, -7)],
});

/** Too few counted segments: no payoff. */
export const shortPayoffPlan: PayoffPlan = plan({
  name: 'Quiet Feud',
  heat: 48,
  countedSegments: 1,
  finalePlayed: false,
  quality: 0,
  members: [member('Ise', 0, 0), member('Rook', 0, 0)],
});

/** A member who left gets nothing; the others are paid. */
export const skippedPayoffPlan: PayoffPlan = plan({
  name: 'Tag Title Chase',
  heat: 74,
  countedSegments: 4,
  finalePlayed: false,
  quality: 0.6,
  members: [member('Juno Hart', 1.8, 6), member('Dax Kell', 0, 0, 'Left the promotion: no payoff')],
});
