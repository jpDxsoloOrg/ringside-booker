// The Health screens' Why? panels in the panel's words (WRK6-08 review): fatigue recovery, the age
// cap, next week's recovery, time out, condition lost and the off-screen chance. Each is built by
// the engine's own formula, so the words checked here are the ones a player reads.
// Design: docs/design/health.md
import {
  computeConditionCap,
  computeConditionRecovery,
  computeFatigueRecovery,
  computeInjuryConditionLoss,
  computeInjuryDays,
  computeOffscreenInjuryChance,
  createEngineTunables,
  decideInjurySeverity,
  INJURIES_STREAM,
  medicalCareLabel,
  RngRegistry,
} from '@ringside/engine';
import type { EngineTunables, TraceNode } from '@ringside/engine';
import { describe, expect, it } from 'vitest';
import { traceToText } from './traceToText';
import { describeTraceNode } from './wording';

const AGE = 41;
const PROMOTION = 'Apex Wrestling';

/** A tunable key or a code where words belong: `health.fatigue.x`, `injuryProne`, `legs`. */
const RAW_KEY = /\bhealth\.[a-z]|\b[a-z]+[A-Z][a-zA-Z]*\b|^(head|neck|back|arms|torso|legs)\b/;

function nodes(root: TraceNode): TraceNode[] {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}

/** Every row's sentence (not its details, where a setting's key belongs). */
function sentences(root: TraceNode): string[] {
  return nodes(root).map((node) => describeTraceNode(node).text);
}

function tunableRows(root: TraceNode) {
  return nodes(root).flatMap((node) =>
    node.kind === 'tunable' ? [{ node, line: describeTraceNode(node) }] : [],
  );
}

interface HealthTraces {
  readonly fatigueRecovery: TraceNode;
  readonly ageCap: TraceNode;
  readonly nextRecovery: TraceNode;
  readonly timeOut: TraceNode;
  readonly conditionLost: TraceNode;
  readonly offscreenChance: TraceNode;
}

function healthTraces(tunables: EngineTunables): HealthTraces {
  const rng = new RngRegistry('health-why').stream(INJURIES_STREAM);
  const fatigue = computeFatigueRecovery(
    { fatigue: 60, stamina: 70, age: AGE, traits: [], agingEnabled: true, workedPromo: false },
    { tunables, rng },
  );
  const cap = computeConditionCap({ age: AGE, agingEnabled: true }, { tunables });
  const next = computeConditionRecovery(
    {
      current: 50,
      cap,
      partInjured: false,
      traits: ['durable'],
      medicalLevel: 2,
      medicalSource: PROMOTION,
    },
    { tunables },
  );
  const severity = decideInjurySeverity(
    { weights: { minor: 50, moderate: 30, severe: 20 } },
    { rng },
  );
  const days = computeInjuryDays(
    {
      kind: { label: 'Sprained ankle', minDays: 7, maxDays: 21 },
      severity,
      traits: ['injuryProne'],
      medicalLevel: 2,
      medicalLabel: medicalCareLabel(2, PROMOTION),
    },
    { tunables, rng },
  );
  const loss = computeInjuryConditionLoss({ daysOut: days, currentCondition: 80 }, { tunables });
  const chance = computeOffscreenInjuryChance(
    {
      fatigue: 40,
      worstCondition: 55,
      worstPart: 'legs',
      traits: [],
      computerShortcut: null,
      promotionName: PROMOTION,
    },
    { tunables },
  );
  return {
    fatigueRecovery: fatigue.trace,
    ageCap: cap.trace,
    nextRecovery: next.trace,
    timeOut: days.trace,
    conditionLost: loss.trace,
    offscreenChance: chance.trace,
  };
}

describe('the Health Why? panels, in words', () => {
  const traces = healthTraces(createEngineTunables());
  const cases: readonly (readonly [string, TraceNode])[] = Object.entries(traces);

  it.each(cases)('%s: every row is worded, with no raw key', (_name, trace) => {
    for (const sentence of sentences(trace)) {
      expect(sentence).not.toMatch(RAW_KEY);
      expect(sentence.trim()).not.toBe('');
    }
    expect(traceToText(trace)).not.toMatch(/undefined|NaN|\[object/);
  });

  it.each(cases)('%s: names its settings by label, with the key in the details', (_name, trace) => {
    const rows = tunableRows(trace);
    expect(rows.length).toBeGreaterThan(0);
    for (const { node, line } of rows) {
      expect(line.text.startsWith(`${node.label}: `)).toBe(true);
      expect(line.details).toContain(node.key);
    }
  });

  it('says what each panel is for', () => {
    expect(traceToText(traces.ageCap)).toContain('Healing cap for their age');
    expect(traceToText(traces.timeOut)).toMatch(/Severity roll/);
    expect(traceToText(traces.timeOut)).toContain(`Medical care: ${PROMOTION} (level 2)`);
    expect(traceToText(traces.nextRecovery)).toContain('Durable');
    expect(traceToText(traces.offscreenChance)).toMatch(/Legs/);
    // A daily chance is far under 1%: each step still shows how it moved it.
    expect(traceToText(traces.offscreenChance)).toContain('0.3 → 0.082%');
  });
});

describe('0 means 0 in the Health Why? panels', () => {
  it('a cap drop of 0 a year is shown as 0, as a custom setting, and keeps the cap at 100', () => {
    const traces = healthTraces(createEngineTunables({ 'health.condition.capDropPerYear': 0 }));
    const drop = tunableRows(traces.ageCap).find(
      ({ node }) => node.key === 'health.condition.capDropPerYear',
    );
    expect(drop?.line.text).toMatch(/: 0( points)?$/);
    expect(drop?.line.badge).toBe('Custom setting');
    expect(traces.ageCap.value).toBe(100);
  });

  it('no off-screen injuries a year reads as 0 and makes the chance 0', () => {
    const traces = healthTraces(createEngineTunables({ 'health.offscreen.injuriesPerYear': 0 }));
    const rate = tunableRows(traces.offscreenChance).find(
      ({ node }) => node.key === 'health.offscreen.injuriesPerYear',
    );
    expect(rate?.line.text).toMatch(/: 0\b/);
    expect(rate?.line.badge).toBe('Custom setting');
    expect(traces.offscreenChance.value).toBe(0);
  });
});
