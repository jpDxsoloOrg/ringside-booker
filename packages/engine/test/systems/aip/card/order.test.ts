// Ordering the card. Design: docs/design/rival-booking.md#ordering
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { inputOf, startDecision, traceNodeSchema, type Traced } from '../../../../src/core/trace';
import { emptyCrew } from '../../../../src/systems/booking/draft';
import {
  ASCENDING_RULE,
  CANNOT_SPACE_NOTE,
  HOT_OPENER_RULE,
  MAIN_EVENT_ANY_RULE,
  MAIN_EVENT_MATCH_RULE,
  OPENER_GIVES_WAY,
  orderCard,
  PRE_SHOW_RULE,
  slotKeyOf,
  SPACED_RULE,
  type CardOrder,
  type FixedSegment,
  type PlannedSegment,
} from '../../../../src/systems/aip';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable } from '../../../support/trace';

const defaults = createEngineTunables();

/** A planned segment: `m60` is a match scoring 60, `t40` a talking segment scoring 40. */
function segment(code: string, index: number): PlannedSegment {
  const kind = code.startsWith('t') ? 'angle' : 'match';
  const key = `${kind === 'angle' ? 'talk' : 'filler'}:${String(index + 1)}`;
  const label = `${code}#${String(index)}`;
  const base = { label: null, storylineIds: [], crew: emptyCrew(), participants: [] };
  return {
    key,
    kind,
    draft:
      kind === 'match'
        ? {
            kind,
            ...base,
            match: {
              matchTypeKey: parseContentKey('match.singles'),
              stipulationKeys: [],
              titleIds: [],
              finishKey: null,
            },
            outcome: null,
          }
        : { kind, ...base, angle: { angleTypeKey: parseContentKey('angle.promo') } },
    source: kind === 'angle' ? 'talk' : 'filler',
    trace: startDecision<string>(label).choose(kind, 'test'),
  };
}

interface Setup {
  readonly codes: readonly string[];
  readonly slots: number;
  readonly preShowSlots?: number;
  readonly house?: boolean;
  readonly fixed?: Readonly<Record<string, FixedSegment['kind']>>;
  readonly tunables?: EngineTunables;
}

function order(setup: Setup): { result: CardOrder; card: Map<string, string> } {
  const segments = setup.codes.map(segment);
  const scores = new Map<string, Traced<number>>(
    segments.map((entry, index) => [
      entry.key,
      inputOf('score', Number((setup.codes[index] ?? '0').slice(1))),
    ]),
  );
  const fixed = new Map<string, FixedSegment>(
    Object.entries(setup.fixed ?? {}).map(([key, kind]) => [key, { kind, label: `fixed ${key}` }]),
  );
  const result = orderCard(
    segments,
    scores,
    {
      slots: setup.slots,
      preShowSlots: setup.preShowSlots ?? 0,
      mainEventMustBeMatch: setup.house !== true,
      fixed,
    },
    { tunables: setup.tunables ?? defaults },
  );
  expectSerialisable(result);
  expect(traceNodeSchema.safeParse(result.trace).success).toBe(true);
  const card = new Map<string, string>();
  for (const [key, entry] of fixed) {
    card.set(key, entry.kind === 'angle' ? 'FIXED-T' : 'FIXED-M');
  }
  for (const placement of result.placements) {
    const index = segments.findIndex((entry) => entry.key === placement.segmentKey);
    const slotKey = slotKeyOf(placement.preShow, placement.slot);
    expect(card.has(slotKey), `${slotKey} taken twice`).toBe(false);
    card.set(slotKey, setup.codes[index] ?? '?');
  }
  return { result, card };
}

/** The main card as codes, slot 0 first ('-' for an empty slot). */
function mainCard(card: Map<string, string>, slots: number): string[] {
  return Array.from({ length: slots }, (_, slot) => card.get(slotKeyOf(false, slot)) ?? '-');
}

function isTalk(code: string): boolean {
  return code.startsWith('t') || code === 'FIXED-T';
}

function labelsOf(result: CardOrder): string[] {
  return (result.trace.children ?? []).map((node) => node.label);
}

describe('orderCard', () => {
  it('closes with the strongest match and opens with the second best', () => {
    const { result, card } = order({ codes: ['m50', 'm80', 'm60', 'm70', 't90'], slots: 5 });
    const main = mainCard(card, 5);
    expect(main[4]).toBe('m80');
    expect(main[0]).toBe('m70');
    expect(main.slice(1, 4)).toEqual(['m50', 'm60', 't90']);
    const rules = new Map(result.placements.map((entry) => [entry.slot, entry.rule]));
    expect(rules.get(4)).toBe(MAIN_EVENT_MATCH_RULE);
    expect(rules.get(0)).toBe(HOT_OPENER_RULE);
    expect(rules.get(1)).toBe(ASCENDING_RULE);
  });

  it('keeps the plain ascending order without the hot opener or with fewer than three matches', () => {
    const off = createEngineTunables({ 'aip.card.order.hotOpener': false });
    expect(
      mainCard(order({ codes: ['m50', 'm80', 'm60', 'm70'], slots: 4, tunables: off }).card, 4),
    ).toEqual(['m50', 'm60', 'm70', 'm80']);
    expect(mainCard(order({ codes: ['m50', 'm80', 't40'], slots: 3 }).card, 3)).toEqual([
      't40',
      'm50',
      'm80',
    ]);
  });

  it('lets a house show end on its best segment of any kind', () => {
    const { card, result } = order({ codes: ['m50', 't90', 'm60'], slots: 3, house: true });
    expect(mainCard(card, 3)[2]).toBe('t90');
    expect(result.placements.find((entry) => entry.slot === 2)?.rule).toBe(MAIN_EVENT_ANY_RULE);
  });

  it('never puts two talking segments in a row, moving them apart with a line', () => {
    const { card, result } = order({
      codes: ['t10', 't20', 'm50', 'm60', 'm70', 'm80'],
      slots: 6,
    });
    const main = mainCard(card, 6);
    for (let slot = 1; slot < main.length; slot++) {
      expect(isTalk(main[slot - 1] ?? '') && isTalk(main[slot] ?? '')).toBe(false);
    }
    expect(main[5]).toBe('m80');
    expect(labelsOf(result).some((label) => label.startsWith(SPACED_RULE))).toBe(true);
  });

  it('gives up the hot opener when the talking segments need the room', () => {
    // Six slots, three talking segments: only talk-match-talk-match-talk-match keeps them apart.
    const { card, result } = order({
      codes: ['t10', 't20', 't30', 'm50', 'm60', 'm80'],
      slots: 6,
    });
    expect(mainCard(card, 6)).toEqual(['t10', 'm50', 't20', 'm60', 't30', 'm80']);
    expect(labelsOf(result)).toContain(OPENER_GIVES_WAY);
  });

  it('puts the lowest matches on the pre-show and never a talking segment', () => {
    const { card, result } = order({
      codes: ['t5', 'm10', 'm20', 'm50', 'm60', 'm70'],
      slots: 4,
      preShowSlots: 2,
    });
    expect(card.get('pre:0')).toBe('m10');
    expect(card.get('pre:1')).toBe('m20');
    expect(result.placements.filter((entry) => entry.preShow).map((entry) => entry.rule)).toEqual([
      PRE_SHOW_RULE,
      PRE_SHOW_RULE,
    ]);
    expect(mainCard(card, 4)).toContain('t5');
  });

  it('leaves the pre-show empty when the flag is off', () => {
    const off = createEngineTunables({ 'aip.card.fillPreShow': false });
    const { card, result } = order({
      codes: ['m10', 'm20', 'm50'],
      slots: 2,
      preShowSlots: 1,
      tunables: off,
    });
    expect(card.has('pre:0')).toBe(false);
    expect(result.unplaced).toHaveLength(1);
  });

  it('never moves a fixed segment and only fills open slots', () => {
    const fixed = { 'main:2': 'match', 'main:4': 'match' } as const;
    const { card, result } = order({ codes: ['m10', 'm20', 'm30'], slots: 5, fixed });
    expect(card.get('main:2')).toBe('FIXED-M');
    expect(card.get('main:4')).toBe('FIXED-M');
    expect(result.placements.map((entry) => entry.slot).sort()).toEqual([0, 1, 3]);
  });

  it('keeps talking apart around a fixed talking segment', () => {
    const fixed = { 'main:1': 'angle' } as const;
    const { card } = order({ codes: ['t10', 'm20', 'm30', 'm40'], slots: 5, fixed });
    const main = mainCard(card, 5);
    expect(main[1]).toBe('FIXED-T');
    for (let slot = 1; slot < main.length; slot++) {
      expect(isTalk(main[slot - 1] ?? '') && isTalk(main[slot] ?? '')).toBe(false);
    }
  });

  it('keeps the order with a note when fixed slots leave no way to space talking', () => {
    const fixed = { 'main:0': 'angle', 'main:2': 'angle' } as const;
    const { card, result } = order({ codes: ['t10', 'm20'], slots: 4, fixed });
    expect(labelsOf(result)).toContain(CANNOT_SPACE_NOTE);
    expect(card.get('main:3')).toBe('m20');
    expect(card.get('main:1')).toBe('t10');
  });

  it('leaves the empty slots of a short card early, never just before the main event', () => {
    const off = createEngineTunables({ 'aip.card.order.hotOpener': false });
    expect(
      mainCard(order({ codes: ['m50', 'm80', 'm60'], slots: 6, tunables: off }).card, 6),
    ).toEqual(['-', '-', '-', 'm50', 'm60', 'm80']);
    // With the hot opener the gap falls just after the opener.
    expect(mainCard(order({ codes: ['m50', 'm80', 'm60', 'm70'], slots: 6 }).card, 6)).toEqual([
      'm70',
      '-',
      '-',
      'm50',
      'm60',
      'm80',
    ]);
  });

  it('never fills more slots than the card has', () => {
    const { result } = order({ codes: ['m10', 'm20', 'm30', 'm40', 't5'], slots: 3 });
    expect(result.placements).toHaveLength(3);
    expect(result.unplaced).toHaveLength(2);
  });
});
