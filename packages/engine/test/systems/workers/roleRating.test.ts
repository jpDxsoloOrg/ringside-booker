// Role ratings. Design: docs/design/workers.md#role-ratings
import { describe, expect, it } from 'vitest';
import { findTraceNodes } from '../../../src/core/trace';
import { describeTunables } from '../../../src/core/tunables/describe';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { ATTRIBUTE_KEYS, type Attributes } from '../../../src/model/entities/person';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  DEFAULT_RATING_WEIGHTS,
  NO_WEIGHTS_NOTE,
  OCCASIONAL_WRESTLER_NOTE,
  overallByRole,
  overallOf,
  RATING_ROLES,
  ratingWeightKey,
  roleRating,
  type RatingRole,
} from '../../../src/systems/workers';
import { aPerson } from '../../support/builders/people';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import { attributesOf } from './push-fixtures';

function ratingOf(role: RatingRole, attributes: Attributes, overrides: TunableOverrides = {}) {
  const result = roleRating({ role, attributes }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  return result;
}

/** Overrides that set every weight of `role` to 0. */
function noWeights(role: RatingRole): TunableOverrides {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [ratingWeightKey(role, key), 0]));
}

describe('roleRating', () => {
  it.each(RATING_ROLES)('rates all-100 attributes as 100 for a %s', (role) => {
    expect(ratingOf(role, attributesOf(100)).value).toBe(100);
  });

  it.each(RATING_ROLES)('rates all-0 attributes as 0 for a %s', (role) => {
    expect(ratingOf(role, attributesOf(0)).value).toBe(0);
  });

  it('is the weighted mean of the counted attributes', () => {
    const attributes = attributesOf(50, { officiating: 90, psychology: 60, stamina: 40 });
    // (90 × 4 + 60 × 1 + 40 × 0.5) ÷ 5.5
    expect(ratingOf('referee', attributes).value).toBeCloseTo(440 / 5.5, 10);
  });

  it('is not rounded', () => {
    const attributes = attributesOf(50, { officiating: 71 });
    expect(ratingOf('referee', attributes).value).toBeCloseTo((71 * 4 + 50 + 25) / 5.5, 10);
    expect(Number.isInteger(ratingOf('referee', attributes).value)).toBe(false);
  });

  it('lists each counted attribute × weight in attribute order, then the total weight', () => {
    const attributes = attributesOf(50, { ringwork: 72, psychology: 64.5 });
    const result = ratingOf('wrestler', attributes);
    const formula = expectTraceContains(result, { kind: 'formula', label: 'Wrestler rating' });
    expect(formula.unit).toBe('points');
    expect(formula.docRef).toBe('workers.md#role-ratings');
    expect(findTraceNodes(result.trace, 'add').map((node) => node.label)).toEqual([
      'Ring work 72 × weight 3',
      'Psychology 64.5 × weight 2',
      'Stamina 50 × weight 1',
      'Safety 50 × weight 1',
      'Athleticism 50 × weight 1.5',
      'Mic skills 50 × weight 1',
      'Charisma 50 × weight 1.5',
      'Presence 50 × weight 1',
    ]);
    const divide = expectTraceContains(result, { kind: 'divide' });
    expect(divide.label).toBe('Total weight 12');
    expect(divide.operand).toBe(12);
    expectTraceContains(result, { kind: 'clamp' });
  });

  it('names the tunable behind every weight', () => {
    const result = ratingOf('wrestler', attributesOf(50));
    const tunables = findTraceNodes(result.trace, 'tunable');
    expect(tunables.map((node) => node.key)).toEqual([
      'workers.rating.wrestler.ringwork',
      'workers.rating.wrestler.psychology',
      'workers.rating.wrestler.stamina',
      'workers.rating.wrestler.safety',
      'workers.rating.wrestler.athleticism',
      'workers.rating.wrestler.mic',
      'workers.rating.wrestler.charisma',
      'workers.rating.wrestler.presence',
    ]);
    const ringwork = expectTraceContains(result, { kind: 'tunable', label: 'Ring work weight' });
    expect(ringwork.value).toBe(3);
    expect(ringwork.overridden).toBe(false);
  });

  it('gives the attribute itself when it is the only one with a weight', () => {
    const overrides = { ...noWeights('wrestler'), 'workers.rating.wrestler.charisma': 2.5 };
    const result = ratingOf('wrestler', attributesOf(50, { charisma: 83 }), overrides);
    expect(result.value).toBe(83);
    expect(findTraceNodes(result.trace, 'add')).toHaveLength(1);
  });

  it('drops an attribute whose weight is overridden to 0', () => {
    const attributes = attributesOf(50, { ringwork: 100 });
    const before = ratingOf('wrestler', attributes);
    const after = ratingOf('wrestler', attributes, { 'workers.rating.wrestler.ringwork': 0 });
    expect(before.value).toBeGreaterThan(50);
    expect(after.value).toBe(50);
    const labels = findTraceNodes(after.trace, 'add').map((node) => node.label);
    expect(labels).toHaveLength(7);
    expect(labels.some((label) => label.startsWith('Ring work'))).toBe(false);
    expect(expectTraceContains(after, { kind: 'divide' }).label).toBe('Total weight 9');
    const keys = findTraceNodes(after.trace, 'tunable').map((node) => node.key);
    expect(keys).not.toContain('workers.rating.wrestler.ringwork');
  });

  it('counts an attribute a role does not use by default once it is given a weight', () => {
    const attributes = attributesOf(50, { booking: 100 });
    expect(ratingOf('wrestler', attributes).value).toBe(50);
    const result = ratingOf('wrestler', attributes, { 'workers.rating.wrestler.booking': 4 });
    expect(result.value).toBeCloseTo((50 * 12 + 100 * 4) / 16, 10);
    const weight = expectTraceContains(result, { kind: 'tunable', label: 'Booking weight' });
    expect(weight.overridden).toBe(true);
    expect(weight.defaultValue).toBe(0);
  });

  it('gives 0 with a note when every weight for the role is 0', () => {
    const result = ratingOf('referee', attributesOf(100), noWeights('referee'));
    expect(result.value).toBe(0);
    expectTraceContains(result, { kind: 'note', label: NO_WEIGHTS_NOTE });
    expect(findTraceNodes(result.trace, 'add')).toEqual([]);
    // The other roles are untouched.
    expect(ratingOf('wrestler', attributesOf(100), noWeights('referee')).value).toBe(100);
  });
});

describe('overallOf and overallByRole', () => {
  const tunables = createEngineTunables();

  it('rates a person in every role', () => {
    const person = aPerson({ attributes: { ringwork: 80, officiating: 20, booking: 95 } });
    const ratings = overallByRole(person, { tunables });
    expect(Object.keys(ratings)).toEqual([...RATING_ROLES]);
    for (const role of RATING_ROLES) {
      expectTraceReplays(ratings[role]);
      expect(ratings[role].value).toBe(
        roleRating({ role, attributes: person.attributes }, { tunables }).value,
      );
    }
    expect(ratings.booker.value).toBeGreaterThan(ratings.wrestler.value);
    expect(ratings.wrestler.value).toBeGreaterThan(ratings.referee.value);
  });

  it('rates an occasional wrestler with the wrestler weights and says so', () => {
    const partTimer = aPerson({ roles: ['occasionalWrestler', 'manager'] });
    const asWrestler = overallOf(partTimer, 'wrestler', { tunables });
    expectTraceReplays(asWrestler);
    expectTraceContains(asWrestler, { kind: 'note', label: OCCASIONAL_WRESTLER_NOTE });
    expect(asWrestler.value).toBe(
      roleRating({ role: 'wrestler', attributes: partTimer.attributes }, { tunables }).value,
    );
    // The note is about the wrestler rating only, and only for people with no full wrestler role.
    const asManager = overallOf(partTimer, 'manager', { tunables });
    expect(findTraceNodes(asManager.trace, 'note')).toEqual([]);
    const fullTimer = aPerson({ roles: ['wrestler'] });
    expect(findTraceNodes(overallOf(fullTimer, 'wrestler', { tunables }).trace, 'note')).toEqual(
      [],
    );
  });
});

describe('the rating weight tunables', () => {
  const reader = createEngineTunables();
  const rows = describeTunables(reader, { keyPrefix: 'workers.rating.' });

  it('has one weight per role and attribute', () => {
    expect(rows).toHaveLength(RATING_ROLES.length * ATTRIBUTE_KEYS.length);
    expect(rows).toHaveLength(84);
    for (const row of rows) {
      expect(row.kind).toBe('number');
      expect(row.unit).toBe('ratio');
      expect([row.min, row.max]).toEqual([0, 10]);
      expect(row.category).toBe('Worker ratings');
      expect(row.docRef).toBe('workers.md#role-ratings');
    }
  });

  it('describes each weight in plain words', () => {
    expect(reader.def('workers.rating.wrestler.ringwork').description).toBe(
      "How much Ring work counts toward a wrestler's rating",
    );
  });

  it('defaults to the documented weights, with 0 for everything unlisted', () => {
    for (const role of RATING_ROLES) {
      for (const attribute of ATTRIBUTE_KEYS) {
        expect(reader.get(ratingWeightKey(role, attribute))).toBe(
          DEFAULT_RATING_WEIGHTS[role][attribute] ?? 0,
        );
      }
    }
    expect(reader.get('workers.rating.wrestler.ringwork')).toBe(3);
    expect(reader.get('workers.rating.referee.officiating')).toBe(4);
    expect(reader.get('workers.rating.referee.ringwork')).toBe(0);
  });

  it('keeps the keys a compile-time union', () => {
    const weight: number = reader.get('workers.rating.booker.booking');
    expect(weight).toBe(4);
    // @ts-expect-error a misspelt role is not a tunable key
    expect(() => reader.get('workers.rating.wrestlr.ringwork')).toThrow();
  });

  it('gives every role at least one weight by default', () => {
    for (const role of RATING_ROLES) {
      const result = roleRating({ role, attributes: attributesOf(60) }, { tunables: reader });
      expectSerialisable(result);
      expect(result.value).toBeCloseTo(60, 10);
    }
  });
});
