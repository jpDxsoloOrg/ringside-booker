// How bad an injury is. Design: docs/design/health.md#injuries
import { describe, expect, it } from 'vitest';
import { RngRegistry } from '../../../src/core/rng/registry';
import type { InjurySeverity } from '../../../src/model/catalogs';
import {
  decideInjurySeverity,
  INJURIES_STREAM,
  SEVERITY_SET_BY_MATCH,
} from '../../../src/systems/health';
import { expectRollRecorded, expectSerialisable, expectTraceContains } from '../../support/trace';

function stream(seed = 'injury-severity-test') {
  return new RngRegistry(seed).stream(INJURIES_STREAM);
}

describe('decideInjurySeverity', () => {
  it('rolls a weighted severity and records the roll and the three options', () => {
    const result = decideInjurySeverity(
      { weights: { minor: 50, moderate: 30, severe: 20 } },
      { rng: stream() },
    );
    expectSerialisable(result);
    const roll = expectRollRecorded(result, INJURIES_STREAM);
    expect(roll).toMatchObject({ kind: 'weighted', label: 'Severity roll', options: 3 });
    expect(result.trace).toMatchObject({
      kind: 'decision',
      label: 'Severity',
      chosen: result.value,
    });
    expect(
      result.trace.kind === 'decision' ? result.trace.considered.map((entry) => entry.score) : [],
    ).toEqual([50, 30, 20]);
  });

  it('only picks severities with weight', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const result = decideInjurySeverity(
        { weights: { minor: 0, moderate: 0, severe: 5 } },
        { rng: stream(seed) },
      );
      expect(result.value).toBe('severe');
    }
  });

  it('takes a forced severity as a rule and draws nothing', () => {
    const used = stream();
    const twin = stream();
    const result = decideInjurySeverity(
      { weights: { minor: 50, moderate: 30, severe: 20 }, forced: 'minor' },
      { rng: used },
    );
    expect(result.value).toBe<InjurySeverity>('minor');
    expect(
      expectTraceContains(result, { kind: 'branch', label: SEVERITY_SET_BY_MATCH }).taken,
    ).toBe(true);
    expect(used.nextUint32()).toBe(twin.nextUint32());
    expectSerialisable(result);
  });

  it('gives the same severity for the same seed', () => {
    const weights = { minor: 50, moderate: 30, severe: 20 };
    expect(decideInjurySeverity({ weights }, { rng: stream('x') }).value).toBe(
      decideInjurySeverity({ weights }, { rng: stream('x') }).value,
    );
  });
});
