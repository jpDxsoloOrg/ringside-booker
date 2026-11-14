// Starting patience (ECO5-02). Design: docs/design/negotiation.md#patience
import { describe, expect, it } from 'vitest';
import { inputOf } from '../../../../src/core/trace/helpers';
import type { TunableOverrides } from '../../../../src/core/tunables/overrides';
import { startPatience, type StartPatienceInputs } from '../../../../src/systems/negotiation';
import { createEngineTunables } from '../../../../src/systems/tunables';
import {
  expectSerialisable,
  expectTraceContains,
  expectTraceReplays,
} from '../../../support/trace';

const BASE: StartPatienceInputs = { traits: [], renewalMorale: null, modifiers: [] };

function patience(inputs: Partial<StartPatienceInputs> = {}, overrides: TunableOverrides = {}) {
  const result = startPatience(
    { ...BASE, ...inputs },
    { tunables: createEngineTunables(overrides) },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  expect(Number.isInteger(result.value)).toBe(true);
  return result;
}

describe('startPatience', () => {
  it('starts at the usual patience', () => {
    const result = patience();
    expect(result.value).toBe(3);
    expect(result.trace).toMatchObject({ label: 'Patience', unit: 'count' });
    expectTraceContains(result, { kind: 'add', label: 'Usual patience' });
  });

  it('takes one off an egotist and adds one for a professional', () => {
    expect(patience({ traits: ['egotist'] }).value).toBe(2);
    expect(patience({ traits: ['professional'] }).value).toBe(4);
    expect(patience({ traits: ['egotist', 'professional'] }).value).toBe(3);
  });

  it('takes one off a renewal below the unhappy line, not at it', () => {
    expect(patience({ renewalMorale: -20 }).value).toBe(3);
    const unhappy = patience({ renewalMorale: -21 });
    expect(unhappy.value).toBe(2);
    expectTraceContains(unhappy, { kind: 'subtract', label: 'Morale −21: unhappy here' });
    // A signing has no morale line at all.
    expect(patience({ renewalMorale: null }).value).toBe(3);
  });

  it('adds registered modifiers and rounds down', () => {
    const result = patience({ modifiers: [inputOf('Rapport with your booker', 1.6)] });
    expect(result.value).toBe(4);
    expectTraceContains(result, { kind: 'add', label: 'Rapport with your booker' });
  });

  it('keeps patience within 0 and the most anyone has', () => {
    expect(patience({ modifiers: [inputOf('Bad blood', -9)] }).value).toBe(0);
    const most = patience({ traits: ['professional'], modifiers: [inputOf('Old friends', 5)] });
    expect(most.value).toBe(5);
    expect(
      expectTraceContains(most, { kind: 'min', label: 'Most patience anyone has' }).applied,
    ).toBe(true);
    expect(patience({}, { 'contracts.patience.max': 0 }).value).toBe(0);
  });

  it('treats the tunables at 0 as 0', () => {
    expect(patience({ traits: ['egotist'] }, { 'contracts.patience.base': 0 }).value).toBe(0);
    expect(patience({ traits: ['egotist'] }, { 'contracts.patience.egotist': 0 }).value).toBe(3);
    expect(
      patience({ traits: ['professional'] }, { 'contracts.patience.professional': 0 }).value,
    ).toBe(3);
    expect(patience({ renewalMorale: -80 }, { 'contracts.patience.unhappyPenalty': 0 }).value).toBe(
      3,
    );
  });
});
