// How long an injury keeps someone out. Design: docs/design/health.md#injuries
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../src/core/rng/registry';
import { findTraceNodes, untraced, type Traced } from '../../../src/core/trace';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import type { InjurySeverity } from '../../../src/model/catalogs';
import {
  AT_LEAST_A_DAY,
  computeInjuryDays,
  decideInjurySeverity,
  INJURIES_STREAM,
  medicalCareLabel,
  NEITHER_TRAIT_BRANCH,
  SEVERITY_SET_BY_MATCH,
  type InjuryDaysInputs,
} from '../../../src/systems/health';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  expectRollRecorded,
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../support/trace';

function stream() {
  return new RngRegistry('injury-days-test').stream(INJURIES_STREAM);
}

function forced(severity: InjurySeverity): Traced<InjurySeverity> {
  return decideInjurySeverity(
    { weights: { minor: 1, moderate: 1, severe: 1 }, forced: severity },
    { rng: stream() },
  );
}

/** A fixed 20-day kind, a moderate injury, no body trait, standard care from Apex. */
const BASE: InjuryDaysInputs = {
  kind: { label: 'Test arm injury', minDays: 20, maxDays: 20 },
  severity: forced('moderate'),
  traits: [],
  medicalLevel: 1,
  medicalLabel: medicalCareLabel(1, 'Apex Wrestling'),
};

function days(inputs: Partial<InjuryDaysInputs> = {}, overrides: TunableOverrides = {}) {
  const result = computeInjuryDays(
    { ...BASE, ...inputs },
    { tunables: createEngineTunables(overrides), rng: stream() },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeInjuryDays', () => {
  it('keeps a moderate injury at standard care to the rolled days, and says how', () => {
    const result = days();
    expect(result.value).toBe(20);
    expect(result.trace).toMatchObject({
      label: 'Days out',
      docRef: 'docs/design/health.md#injuries',
    });
    const roll = expectTraceContains(result, {
      kind: 'roll',
      label: 'Test arm injury: 20–20 days',
    });
    expect(roll.roll).toMatchObject({ stream: INJURIES_STREAM, kind: 'int', min: 20, max: 20 });
    expect(expectTraceContains(result, { kind: 'branch', label: NEITHER_TRAIT_BRANCH }).taken).toBe(
      true,
    );
    expectTraceContains(result, {
      kind: 'multiply',
      label: 'Medical care: Apex Wrestling (level 1)',
    });
  });

  it('rolls inside the catalog range and names it', () => {
    const result = days({ kind: { label: 'Sprained ankle', minDays: 7, maxDays: 21 } });
    const roll = expectRollRecorded(result, INJURIES_STREAM);
    expect(roll).toMatchObject({ min: 7, max: 21, label: 'Catalog range' });
    expect(result.value).toBeGreaterThanOrEqual(7);
    expect(result.value).toBeLessThanOrEqual(21);
    expectTraceContains(result, { kind: 'roll', label: 'Sprained ankle: 7–21 days' });
  });

  it('scales by severity and attaches the severity decision', () => {
    expect(days({ severity: forced('minor') }).value).toBe(12);
    expect(days({ severity: forced('severe') }).value).toBe(36);
    const result = days({ severity: forced('severe') });
    const step = expectTraceContains(result, { kind: 'multiply', label: 'Severe injury' });
    expect(step.operand).toBe(1.8);
    const decision = findTraceNodes(result.trace, 'decision').find(
      (node) => node.label === 'Severity',
    );
    expect(decision?.chosen).toBe('severe');
    expectTraceContains(result, { kind: 'branch', label: SEVERITY_SET_BY_MATCH });
    expect(
      expectTraceContains(result, {
        kind: 'tunable',
        label: 'Severe injury',
      }).key,
    ).toBe('health.injury.severityMultiplier.severe');
  });

  it('rounds up', () => {
    expect(
      days({ kind: { label: 'Bruise', minDays: 21, maxDays: 21 }, severity: forced('minor') })
        .value,
    ).toBe(13);
  });

  it('shortens time out for a durable worker and lengthens it for an injury-prone one', () => {
    const durable = days({ traits: ['durable'] });
    expect(durable.value).toBe(15);
    expect(expectTraceContains(durable, { kind: 'branch', label: 'Durable' }).taken).toBe(true);
    const prone = days({ traits: ['injuryProne'] });
    expect(prone.value).toBe(27);
    expect(expectTraceContains(prone, { kind: 'tunable', label: 'Injury prone' }).key).toBe(
      'health.injury.injuryProneMultiplier',
    );
    expect(days({ traits: ['workhorse'] }).value).toBe(20);
  });

  it('applies each medical level, labelled with the promotion', () => {
    const at = (level: 0 | 1 | 2 | 3) =>
      days({ medicalLevel: level, medicalLabel: medicalCareLabel(level, 'Apex Wrestling') });
    expect(at(0).value).toBe(24);
    expect(at(1).value).toBe(20);
    expect(at(2).value).toBe(18);
    expect(at(3).value).toBe(16);
    expect(
      expectTraceContains(at(3), {
        kind: 'tunable',
        label: 'Medical care: Apex Wrestling (level 3)',
      }).key,
    ).toBe('health.medical.injuryMultiplier.level3');
    const freeAgent = days({ medicalLabel: medicalCareLabel(1, null) });
    expectTraceContains(freeAgent, { kind: 'multiply', label: 'No employer: standard care' });
  });

  it('still costs a day when a severity multiplier is 0', () => {
    const result = days({}, { 'health.injury.severityMultiplier.moderate': 0 });
    expect(result.value).toBe(1);
    const floor = expectTraceContains(result, { kind: 'max', label: 'At least a day' });
    expect(floor.applied).toBe(true);
    expect(JSON.stringify(result.trace)).toContain(AT_LEAST_A_DAY);
  });

  it('caps at health.injury.maxDays, and the default cap leaves a long injury alone', () => {
    const long = { label: 'Torn ACL', minDays: 300, maxDays: 300 };
    expect(days({ kind: long, severity: forced('severe') }).value).toBe(540);
    expect(days({ kind: long }).value).toBe(300);
    const capped = days({ severity: forced('severe') }, { 'health.injury.maxDays': 30 });
    expect(capped.value).toBe(30);
    expect(expectTraceContains(capped, { kind: 'min', label: 'Longest time out' }).applied).toBe(
      true,
    );
    expect(days({}, { 'health.injury.maxDays': 20 }).value).toBe(20);
  });

  it('draws exactly once', () => {
    const used = stream();
    const twin = stream();
    computeInjuryDays(
      { ...BASE, kind: { label: 'Sprain', minDays: 1, maxDays: 50 } },
      { tunables: createEngineTunables(), rng: used },
    );
    twin.nextUint32();
    expect(used.nextUint32()).toBe(twin.nextUint32());
  });

  it('works from a plain severity input too', () => {
    const plain = untraced<InjurySeverity>('minor', 'Severity');
    expect(days({ severity: plain }).value).toBe(12);
  });
});
