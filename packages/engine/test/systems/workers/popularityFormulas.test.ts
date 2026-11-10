// Popularity anchor and one region's popularity change. Design: docs/design/workers.md#popularity-door
import { describe, expect, it } from 'vitest';
import { describeTunables } from '../../../src/core/tunables/describe';
import type { TunableOverrides } from '../../../src/core/tunables/overrides';
import { inputOf, type Traced } from '../../../src/core/trace';
import { createEngineTunables } from '../../../src/systems/tunables';
import {
  popularityAnchor,
  popularityChange,
  type PopularityChangeInputs,
} from '../../../src/systems/workers';
import { expectTraceContains, expectTraceReplays } from '../../support/trace';

function anchorOf(charisma: number, overrides: TunableOverrides = {}): Traced<number> {
  const result = popularityAnchor({ charisma }, { tunables: createEngineTunables(overrides) });
  expectTraceReplays(result);
  return result;
}

function changeOf(
  inputs: Partial<PopularityChangeInputs> & { charisma?: number },
  overrides: TunableOverrides = {},
): Traced<number> {
  const tunables = createEngineTunables(overrides);
  const subjectKind = inputs.subjectKind ?? 'person';
  const result = popularityChange(
    {
      subjectKind,
      regionName: 'Test Region',
      before: 50,
      delta: 10,
      weight: 1,
      anchor:
        subjectKind === 'person'
          ? popularityAnchor({ charisma: inputs.charisma ?? 50 }, { tunables })
          : null,
      ...inputs,
    },
    { tunables },
  );
  expectTraceReplays(result);
  return result;
}

describe('popularityAnchor', () => {
  it.each([
    [0, 0],
    [50, 50],
    [100, 100],
  ])('charisma %d anchors at %d by default', (charisma, expected) => {
    expect(anchorOf(charisma).value).toBe(expected);
  });

  it('names the tunable and its doc section', () => {
    const result = anchorOf(60);
    const tunable = expectTraceContains(result, { kind: 'tunable', label: 'Anchor from charisma' });
    expect(tunable.key).toBe('workers.popularity.anchorFromCharisma');
    expect(result.trace.docRef).toBe('workers.md#popularity-door');
  });

  it('stays within 0 to 100 when the factor is at its maximum', () => {
    const result = anchorOf(80, { 'workers.popularity.anchorFromCharisma': 2 });
    expect(result.value).toBe(100);
    expect(expectTraceContains(result, { kind: 'clamp' }).applied).toBe(true);
  });

  it('treats a factor of 0 as 0', () => {
    expect(anchorOf(80, { 'workers.popularity.anchorFromCharisma': 0 }).value).toBe(0);
  });
});

describe('popularityChange', () => {
  it('adds the weighted change below the anchor', () => {
    expect(changeOf({ before: 20, delta: 10, weight: 0.5 }).value).toBe(25);
  });

  it('does not taper a gain made exactly at the anchor', () => {
    const result = changeOf({ before: 50, delta: 10 });
    expect(result.value).toBe(60);
    expect(expectTraceContains(result, { kind: 'branch' }).taken).toBe(false);
  });

  it('tapers a gain above the anchor by how far above it they are', () => {
    // 20 points above an anchor of 50 uses half of the 40-point span, so half the gain lands.
    const result = changeOf({ before: 70, delta: 10 });
    expect(result.value).toBe(75);
    expect(expectTraceContains(result, { kind: 'branch' }).taken).toBe(true);
    const taper = expectTraceContains(result, {
      kind: 'formula',
      label: 'Share of the gain kept above the anchor',
    });
    expect(taper.value).toBe(0.5);
  });

  it('never tapers below the floor', () => {
    // 45 points above the anchor is past the whole span, so the floor of a quarter applies.
    const result = changeOf({ before: 95, delta: 10 });
    expect(result.value).toBe(97.5);
    expect(expectTraceContains(result, { kind: 'max', label: 'Taper floor' }).applied).toBe(true);
  });

  it('lets a floor of 0 stop a gain completely', () => {
    expect(changeOf({ before: 95, delta: 10 }, { 'workers.popularity.taperFloor': 0 }).value).toBe(
      95,
    );
  });

  it('applies the floor straight away when the span is 0, with no division', () => {
    const result = changeOf({ before: 51, delta: 10 }, { 'workers.popularity.taperSpan': 0 });
    expect(result.value).toBe(53.5);
    expect(result.trace.children?.some((node) => node.kind === 'divide')).toBe(true);
    const taper = expectTraceContains(result, {
      kind: 'formula',
      label: 'Share of the gain kept above the anchor',
    });
    expect(taper.children.some((node) => node.kind === 'divide')).toBe(false);
  });

  it('follows a moved anchor', () => {
    // With the anchor at 100 for charisma 50, nobody is above it, so nothing tapers.
    expect(
      changeOf({ before: 70, delta: 10 }, { 'workers.popularity.anchorFromCharisma': 2 }).value,
    ).toBe(80);
  });

  it('never tapers a loss', () => {
    const result = changeOf({ before: 90, delta: -10 });
    expect(result.value).toBe(80);
    expect(expectTraceContains(result, { kind: 'branch' }).taken).toBe(false);
  });

  it('never tapers a promotion', () => {
    const result = changeOf({ subjectKind: 'promotion', before: 90, delta: 5 });
    expect(result.value).toBe(95);
    expect(result.trace.children?.some((node) => node.kind === 'branch')).toBe(false);
  });

  it.each([
    ['the top', 95, 30, 100],
    ['the bottom', 5, -30, 0],
  ])('stops at %s of the scale', (_end, before, delta, expected) => {
    const result = changeOf({ subjectKind: 'promotion', before, delta });
    expect(result.value).toBe(expected);
    expect(expectTraceContains(result, { kind: 'clamp', label: /0 and 100/ }).applied).toBe(true);
  });

  it.each([
    [1.5, 30],
    [-0.5, 20],
  ])('keeps a weight of %d within 0 to 1 and says so', (weight, expected) => {
    const result = changeOf({ subjectKind: 'promotion', before: 20, delta: 10, weight });
    expect(result.value).toBe(expected);
    expectTraceContains(result, { kind: 'note', label: /is outside 0 to 1/ });
  });

  it('says nothing about a weight already in range', () => {
    const result = changeOf({ subjectKind: 'promotion', before: 20, delta: 10, weight: 0.3 });
    expect(result.value).toBe(23);
    const weight = expectTraceContains(result, { kind: 'formula', label: 'Weight of Test Region' });
    expect(weight.children.some((node) => node.kind === 'note')).toBe(false);
  });

  it('stores two decimal places, as a named constant', () => {
    const result = changeOf({ subjectKind: 'promotion', before: 10, delta: 1, weight: 1 / 3 });
    expect(result.value).toBe(10.33);
    const constant = expectTraceContains(result, { kind: 'constant' });
    expect(constant.value).toBe(100);
    expect(constant.reason).toBe('Stored to two decimal places');
  });

  it("keeps the caller's own working for the change", () => {
    const result = changeOf({
      subjectKind: 'promotion',
      before: 10,
      delta: inputOf('Show rating bonus', 4),
    });
    expect(result.value).toBe(14);
    expectTraceContains(result, { kind: 'input', label: 'Show rating bonus' });
  });

  it('leaves the value alone for a change of 0', () => {
    expect(changeOf({ before: 72.25, delta: 0 }).value).toBe(72.25);
  });
});

describe('door tunables', () => {
  const rows = describeTunables(createEngineTunables()).filter(
    (row) => row.key.startsWith('workers.popularity.') || row.key.startsWith('workers.momentum.'),
  );

  it('are all declared, with a description and a doc section', () => {
    expect(rows.map((row) => [row.key, row.default, row.unit])).toEqual([
      ['workers.momentum.initialPopFactor', 1, 'multiplier'],
      ['workers.popularity.anchorFromCharisma', 1, 'multiplier'],
      ['workers.popularity.dropBelow', 0, 'points'],
      ['workers.popularity.taperFloor', 0.25, 'ratio'],
      ['workers.popularity.taperSpan', 40, 'points'],
    ]);
    for (const row of rows) {
      expect(row.category).toBe('Workers');
      expect(row.description).not.toBe('');
      expect(row.docRef).toMatch(/^workers\.md#(popularity|momentum)-door$/);
    }
  });

  it('all accept 0', () => {
    for (const row of rows) {
      expect(row).toMatchObject({ min: 0 });
    }
  });
});
