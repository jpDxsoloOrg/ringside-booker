/**
 * Injury card fixtures for the gallery (WRK6-05): four injuries and the stored traces behind their
 * Why? buttons, worked out with the engine's own formulas so the panels read as they do in a game.
 */
import {
  computeInjuryConditionLoss,
  computeInjuryDays,
  computeOffscreenInjuryChance,
  createEngineTunables,
  decideInjurySeverity,
  INJURIES_STREAM,
  injuryConditionLossTraceRef,
  injuryRecordChanceTraceRef,
  injuryTraceRef,
  medicalCareLabel,
  parseGameDate,
  parseId,
  RngRegistry,
} from '@ringside/engine';
import type { InjuryId, StoredTrace, TraceRef } from '@ringside/engine';
import type { InjuryCardInjury } from '@/components/InjuryCard';

const STORED_DATE = parseGameDate('2027-02-19');

const MINOR_ID = parseId('injury', 'inj_0000000101');
const SEVERE_ID = parseId('injury', 'inj_0000000102');

function stored(
  ref: TraceRef,
  seq: number,
  value: number,
  trace: StoredTrace['trace'],
): StoredTrace {
  return { ref, date: STORED_DATE, seq, trace, value };
}

/** The days-out, condition-loss and chance traces for one injury, as the engine stores them. */
function tracesFor(injuryId: InjuryId, seed: string, seqFrom: number): StoredTrace[] {
  const tunables = createEngineTunables();
  const rng = new RngRegistry(seed).stream(INJURIES_STREAM);
  const severity = decideInjurySeverity(
    { weights: { minor: 50, moderate: 30, severe: 20 } },
    { rng },
  );
  const days = computeInjuryDays(
    {
      kind: { label: 'Sprained ankle', minDays: 7, maxDays: 21 },
      severity,
      traits: [],
      medicalLevel: 2,
      medicalLabel: medicalCareLabel(2, 'Altura Wrestling Entertainment'),
    },
    { tunables, rng },
  );
  const loss = computeInjuryConditionLoss({ daysOut: days, currentCondition: 72 }, { tunables });
  const chance = computeOffscreenInjuryChance(
    {
      fatigue: 58,
      worstCondition: 61,
      worstPart: 'legs',
      traits: [],
      computerShortcut: null,
      promotionName: 'Altura Wrestling Entertainment',
    },
    { tunables },
  );
  return [
    stored(injuryTraceRef(injuryId), seqFrom, days.value, days.trace),
    stored(injuryConditionLossTraceRef(injuryId), seqFrom + 1, loss.value, loss.trace),
    stored(injuryRecordChanceTraceRef(injuryId), seqFrom + 2, chance.value, chance.trace),
  ];
}

/** Every stored trace the gallery's injury cards can open. */
export function injuryCardTraces(): StoredTrace[] {
  return [...tracesFor(MINOR_ID, 'gallery-minor', 1), ...tracesFor(SEVERE_ID, 'gallery-severe', 4)];
}

function valueOf(traces: readonly StoredTrace[], ref: TraceRef): number {
  const entry = traces.find((trace) => trace.ref.kind === ref.kind && trace.ref.id === ref.id);
  return typeof entry?.value === 'number' ? entry.value : 0;
}

/** An open minor injury from a match, every Why? kept. */
export function minorInjury(): InjuryCardInjury {
  const traces = injuryCardTraces();
  const daysOut = valueOf(traces, injuryTraceRef(MINOR_ID));
  return {
    label: 'Sprained ankle',
    bodyPart: 'legs',
    severity: 'minor',
    since: STORED_DATE,
    expectedReturn: parseGameDate('2027-03-05'),
    returnedOn: null,
    daysOut,
    daysRemaining: 9,
    canWorkAngles: true,
    source: 'segment',
    conditionLoss: valueOf(traces, injuryConditionLossTraceRef(MINOR_ID)),
    durationTraceRef: injuryTraceRef(MINOR_ID),
    conditionLossTraceRef: injuryConditionLossTraceRef(MINOR_ID),
    chanceTraceRef: injuryRecordChanceTraceRef(MINOR_ID),
    pendingNotice: false,
  };
}

/** A severe injury off screen the player has not seen yet. */
export function severeNewInjury(): InjuryCardInjury {
  const traces = injuryCardTraces();
  return {
    label: 'Torn anterior cruciate ligament',
    bodyPart: 'legs',
    severity: 'severe',
    since: STORED_DATE,
    expectedReturn: parseGameDate('2027-09-14'),
    returnedOn: null,
    daysOut: valueOf(traces, injuryTraceRef(SEVERE_ID)),
    daysRemaining: 207,
    canWorkAngles: false,
    source: 'world',
    conditionLoss: valueOf(traces, injuryConditionLossTraceRef(SEVERE_ID)),
    durationTraceRef: injuryTraceRef(SEVERE_ID),
    conditionLossTraceRef: injuryConditionLossTraceRef(SEVERE_ID),
    chanceTraceRef: injuryRecordChanceTraceRef(SEVERE_ID),
    pendingNotice: true,
  };
}

/** A healed injury from last year, as the history shows it: no breakdowns kept. */
export function healedInjury(): InjuryCardInjury {
  return {
    label: 'Concussion',
    bodyPart: 'head',
    severity: 'moderate',
    since: parseGameDate('2026-06-02'),
    expectedReturn: parseGameDate('2026-06-30'),
    returnedOn: parseGameDate('2026-07-01'),
    daysOut: 29,
    daysRemaining: null,
    canWorkAngles: true,
    source: 'segment',
    conditionLoss: 8,
    durationTraceRef: null,
    conditionLossTraceRef: null,
    chanceTraceRef: null,
    pendingNotice: false,
  };
}

/** A current injury whose breakdowns are gone: numbers without a Why? */
export function untracedInjury(): InjuryCardInjury {
  return {
    ...minorInjury(),
    label: 'Bruised ribs',
    bodyPart: 'torso',
    severity: 'moderate',
    durationTraceRef: null,
    conditionLossTraceRef: null,
    chanceTraceRef: null,
  };
}
