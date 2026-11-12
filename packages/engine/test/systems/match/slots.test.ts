// Slot role, duration class and slot weight (D-10). Design: docs/design/match-rating.md#slots
import { describe, expect, it } from 'vitest';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { findTraceNodes } from '../../../src/core/trace';
import {
  SLOT_ROLES,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
  type SlotRole,
} from '../../../src/systems/match';
import { createEngineTunables } from '../../../src/systems/tunables';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';

function depsWith(overrides: TunableOverrides = {}) {
  return { tunables: createEngineTunables(overrides) };
}

const DEPS = depsWith();
const SPRINT = { name: 'Sprint', durationShift: -1 } as const;
const BATTLE_ROYAL = { name: 'Battle Royal', durationShift: 1 } as const;
const SINGLES = { name: 'Singles', durationShift: 0 } as const;

function mainCardRoles(slots: number, deps = DEPS): SlotRole[] {
  const roles: SlotRole[] = [];
  for (let slot = 1; slot <= slots; slot += 1) {
    roles.push(slotRoleOf({ slot, slots, preShow: false }, deps).value);
  }
  return roles;
}

describe('slotRoleOf', () => {
  it('reads a 6-slot card as opener, midcards, semi-main and main event', () => {
    expect(mainCardRoles(6)).toEqual([
      'opener',
      'midcard',
      'midcard',
      'midcard',
      'semiMain',
      'mainEvent',
    ]);
  });

  it('reads a 3-slot card as opener, midcard and main event', () => {
    expect(mainCardRoles(3)).toEqual(['opener', 'midcard', 'mainEvent']);
  });

  it('gives every format exactly one main event, the last main-card slot', () => {
    for (let slots = 3; slots <= 12; slots += 1) {
      for (let preShowSlots = 0; preShowSlots <= 3; preShowSlots += 1) {
        const preShow = Array.from(
          { length: preShowSlots },
          (_, index) => slotRoleOf({ slot: index + 1, slots, preShow: true }, DEPS).value,
        );
        expect(preShow.every((role) => role === 'preShow')).toBe(true);
        const roles = mainCardRoles(slots);
        expect(roles.filter((role) => role === 'mainEvent')).toHaveLength(1);
        expect(roles.at(-1)).toBe('mainEvent');
        expect(roles[0]).toBe('opener');
        expect(roles.filter((role) => role === 'semiMain')).toHaveLength(slots >= 4 ? 1 : 0);
      }
    }
  });

  it('has a semi-main only from match.slot.semiMainFromSlots', () => {
    const deps = depsWith({ 'match.slot.semiMainFromSlots': 8 });
    expect(mainCardRoles(7, deps)).not.toContain('semiMain');
    expect(mainCardRoles(8, deps).at(-2)).toBe('semiMain');
    expect(mainCardRoles(4).at(-2)).toBe('semiMain');
  });

  it('names the rule that decided the role', () => {
    const main = slotRoleOf({ slot: 6, slots: 6, preShow: false }, DEPS);
    const decision = expectTraceContains(main, { kind: 'decision', label: 'Slot role' });
    expect(decision.reason).toBe('Last slot of the main card');
    expect(decision.docRef).toBe('match-rating.md#slots');
    expect(
      expectTraceContains(main, { kind: 'branch', label: 'Last slot of the main card' }).taken,
    ).toBe(true);
    expectSerialisable(main);

    const semi = slotRoleOf({ slot: 5, slots: 6, preShow: false }, DEPS);
    expect(expectTraceContains(semi, { kind: 'tunable' }).key).toBe('match.slot.semiMainFromSlots');
    expect(expectTraceContains(semi, { kind: 'decision' }).reason).toBe(
      'Slot before the main event on a card of 4 or more slots',
    );
    const pre = slotRoleOf({ slot: 2, slots: 6, preShow: true }, DEPS);
    expect(expectTraceContains(pre, { kind: 'decision' }).reason).toBe('On the pre-show');
    expectSerialisable(pre);
  });

  it('throws a RangeError for a slot outside the card', () => {
    expect(() => slotRoleOf({ slot: 0, slots: 6, preShow: false }, DEPS)).toThrow(RangeError);
    expect(() => slotRoleOf({ slot: 7, slots: 6, preShow: false }, DEPS)).toThrow(RangeError);
    expect(() => slotRoleOf({ slot: 1, slots: 0, preShow: false }, DEPS)).toThrow(RangeError);
    expect(() => slotRoleOf({ slot: 1.5, slots: 6, preShow: false }, DEPS)).toThrow(RangeError);
  });
});

describe('durationClassOf', () => {
  it('reads the base class from the role', () => {
    const expected: Readonly<Record<SlotRole, string>> = {
      preShow: 'short',
      opener: 'standard',
      midcard: 'standard',
      semiMain: 'standard',
      mainEvent: 'long',
    };
    for (const role of SLOT_ROLES) {
      const result = durationClassOf({ role, matchType: null }, DEPS);
      expect(result.value).toBe(expected[role]);
      expectSerialisable(result);
    }
  });

  it('labels the base class with the role', () => {
    const result = durationClassOf({ role: 'midcard', matchType: SINGLES }, DEPS);
    expect(result.value).toBe('standard');
    const base = expectTraceContains(result, {
      kind: 'tunable',
      label: "Midcard's duration class",
    });
    expect(base.key).toBe('match.slot.durationClass.midcard');
  });

  it('keeps a sprint in the main event long', () => {
    const result = durationClassOf({ role: 'mainEvent', matchType: SPRINT }, DEPS);
    expect(result.value).toBe('long');
    expectTraceContains(result, { kind: 'branch', label: 'Main event stays long' });
    expectTraceContains(result, {
      kind: 'note',
      label: 'D-10: the main event is always the long slot',
    });
    expectSerialisable(result);
  });

  it('pushes a battle royal in a midcard slot up to long', () => {
    const result = durationClassOf({ role: 'midcard', matchType: BATTLE_ROYAL }, DEPS);
    expect(result.value).toBe('long');
    expect(expectTraceContains(result, { kind: 'decision' }).reason).toBe(
      'Battle Royal pushes it up a step → Long',
    );
  });

  it('pulls a sprint in a standard slot down to short', () => {
    const result = durationClassOf({ role: 'opener', matchType: SPRINT }, DEPS);
    expect(result.value).toBe('short');
    expectTraceContains(result, { kind: 'branch', label: 'Sprint pulls it down a step → Short' });
  });

  it('never shifts past short or long', () => {
    expect(durationClassOf({ role: 'preShow', matchType: SPRINT }, DEPS).value).toBe('short');
    expect(durationClassOf({ role: 'mainEvent', matchType: BATTLE_ROYAL }, DEPS).value).toBe(
      'long',
    );
    const longMidcard = depsWith({ 'match.slot.durationClass.midcard': 'long' });
    expect(durationClassOf({ role: 'midcard', matchType: BATTLE_ROYAL }, longMidcard).value).toBe(
      'long',
    );
  });

  it('does not shift a talking segment', () => {
    const result = durationClassOf({ role: 'preShow', matchType: null }, DEPS);
    expect(result.value).toBe('short');
    expect(findTraceNodes(result.trace, 'branch')).toEqual([]);
  });
});

describe('slotWeightOf', () => {
  it('reads each role weight', () => {
    const weights = SLOT_ROLES.map((role) => slotWeightOf({ role }, DEPS).value);
    expect(weights).toEqual([0.4, 0.9, 1, 1.25, 1.75]);
  });

  it('keeps the main event the heaviest slot whatever the override', () => {
    const deps = depsWith({ 'match.slot.weight.mainEvent': 0.5 });
    const main = slotWeightOf({ role: 'mainEvent' }, deps);
    expect(main.value).toBe(1.25);
    for (const role of SLOT_ROLES) {
      expect(main.value).toBeGreaterThanOrEqual(slotWeightOf({ role }, deps).value);
    }
    expectTraceContains(main, {
      kind: 'max',
      label: 'The main event never weighs less than another slot',
    });
    expectTraceReplays(main);
    expectSerialisable(main);
  });

  it('gives 0 for a weight of 0', () => {
    const deps = depsWith({ 'match.slot.weight.opener': 0 });
    const opener = slotWeightOf({ role: 'opener' }, deps);
    expect(opener.value).toBe(0);
    expectTraceReplays(opener);
  });

  it('replays every weight trace', () => {
    for (const role of SLOT_ROLES) {
      const result = slotWeightOf({ role }, DEPS);
      expectTraceReplays(result);
      expectSerialisable(result);
    }
  });
});
