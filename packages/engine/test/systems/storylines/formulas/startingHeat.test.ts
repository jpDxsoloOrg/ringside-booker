// Starting heat (CRTV3-02). Design: docs/design/storylines.md#starting-heat
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../../src/core/ids';
import { findTraceNodes } from '../../../../src/core/trace/helpers';
import type { Traced } from '../../../../src/core/trace/types';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { startingHeat, type StartingHeatMember } from '../../../../src/systems/storylines';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

function heat(
  members: readonly StartingHeatMember[],
  overrides: TunableOverrides = {},
): Traced<number> {
  const result = startingHeat({ members }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

const ISE: StartingHeatMember = { name: 'Ise', homePopularity: 60 };
const KUROE: StartingHeatMember = { name: 'Kuroe', homePopularity: 40 };
const NOBODY: StartingHeatMember = { name: 'Nobody', homePopularity: 10 };

describe('startingHeat', () => {
  it('starts from the base heat, read from storylines.heat.startBase', () => {
    const result = heat([ISE, KUROE]);
    expect(result.trace).toMatchObject({
      kind: 'formula',
      label: 'Starting heat',
      unit: 'points',
      docRef: 'docs/design/storylines.md#starting-heat',
    });
    const [first] = result.trace.children ?? [];
    expect(first).toMatchObject({
      kind: 'tunable',
      key: 'storylines.heat.startBase',
      label: 'Base starting heat',
      value: 25,
    });
  });

  it('gives 25 with no members: the star line is 0 and says why', () => {
    const result = heat([]);
    expect(result.value).toBe(25);
    const star = expectTraceContains(result, { kind: 'add', label: 'Star power' });
    expect(star.operand).toBe(0);
    expect(expectTraceContains(result, { kind: 'constant', label: 'Star power' })).toMatchObject({
      reason: 'No members yet',
    });
  });

  it('counts one member alone: 25 + 0.25 × 60 = 40', () => {
    const result = heat([ISE]);
    expect(result.value).toBe(40);
    expectTraceContains(result, { kind: 'add', label: 'Star power: Ise' });
  });

  it('averages two members: 25 + 0.25 × 50 = 37.5, rounded to 38', () => {
    const result = heat([KUROE, ISE]);
    expect(result.value).toBe(38);
    expectTraceContains(result, { kind: 'add', label: 'Star power: Ise and Kuroe' });
  });

  it('counts only the two best-known of three members', () => {
    expect(heat([NOBODY, ISE, KUROE]).value).toBe(38);
    expect(heat([NOBODY, ISE, KUROE]).trace).toEqual(heat([ISE, KUROE]).trace);
  });

  it('drops the star line entirely with startStarWeight 0', () => {
    const result = heat([ISE, KUROE], { 'storylines.heat.startStarWeight': 0 });
    expect(result.value).toBe(25);
    expect(findTraceNodes(result.trace, 'add')).toEqual([]);
    expectTraceContains(result, { kind: 'branch', label: 'Star power is turned off' });
  });

  it('caps at startMax', () => {
    const result = heat([{ name: 'Star', homePopularity: 100 }], {
      'storylines.heat.startBase': 50,
      'storylines.heat.startMax': 60,
    });
    expect(result.value).toBe(60);
    expect(expectTraceContains(result, { kind: 'min', label: 'Starting heat cap' })).toMatchObject({
      before: 75,
      after: 60,
      applied: true,
    });
  });

  it('gives 0 with base 0 and weight 0 (0 means 0)', () => {
    const result = heat([ISE, KUROE], {
      'storylines.heat.startBase': 0,
      'storylines.heat.startStarWeight': 0,
    });
    expect(result.value).toBe(0);
  });

  it('links each popularity line to its person when the caller names them (CRTV3-05)', () => {
    const ise = { ...ISE, personId: 'per_ise' as PersonId };
    const kuroe = { ...KUROE, personId: 'per_kuroe' as PersonId };
    const inputs = findTraceNodes(heat([ise, kuroe]).trace, 'input');
    expect(inputs.filter((node) => node.ref !== undefined)).toEqual([
      expect.objectContaining({
        label: "Ise's home popularity",
        value: 60,
        ref: { kind: 'person', id: 'per_ise' },
      }),
      expect.objectContaining({
        label: "Kuroe's home popularity",
        value: 40,
        ref: { kind: 'person', id: 'per_kuroe' },
      }),
    ]);
    expect(heat([ise, kuroe]).value).toBe(heat([ISE, KUROE]).value);
  });

  it('leaves the lines plain when no person is named', () => {
    const inputs = findTraceNodes(heat([ISE, KUROE]).trace, 'input');
    expect(inputs.some((node) => node.ref !== undefined)).toBe(false);
  });
});
