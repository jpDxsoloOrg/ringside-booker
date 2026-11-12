// Allowed finishes (MTCH2-01): the match type rule, the two-sides rule and the filter seam MTCH7
// registers stipulation filters through. Design: docs/design/match-finishes.md#allowed-finishes
import { afterEach, describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import { RegistryError } from '../../../src/core/errors';
import type { Catalogs, FinishEntry } from '../../../src/model/catalogs';
import {
  allowedFinishes,
  finishSideCount,
  registerFinishFilter,
  type FinishFilter,
} from '../../../src/systems/match/finishes/allowed';
import { TEST_CATALOGS } from '../../support/catalogs';

const SINGLES = parseContentKey('match.singles');
const TAG = parseContentKey('match.tag-team');
const TRIPLE_THREAT = parseContentKey('match.triple-threat');

const ALL_TEN = [
  'finish.clean',
  'finish.flash',
  'finish.cheating',
  'finish.interference',
  'finish.count-out',
  'finish.disqualification',
  'finish.controversial',
  'finish.double-count-out',
  'finish.stalemate',
  'finish.no-contest',
];

const TWO_SIDE_ONLY = ['finish.count-out', 'finish.disqualification', 'finish.double-count-out'];

function keysOf(entries: readonly { readonly key: string }[]): string[] {
  return entries.map((entry) => entry.key);
}

/** The shipped catalogs with one finish changed. */
function withFinish(key: string, change: (finish: FinishEntry) => FinishEntry): Catalogs {
  const finishes = Object.fromEntries(
    Object.entries(TEST_CATALOGS.finishes ?? {}).map(([entryKey, finish]) => [
      entryKey,
      entryKey === key ? change(finish) : finish,
    ]),
  );
  return { ...TEST_CATALOGS, finishes };
}

const unregisters: (() => void)[] = [];

afterEach(() => {
  for (const unregister of unregisters.splice(0)) {
    unregister();
  }
});

describe('allowedFinishes', () => {
  it('gives a two-sided singles match all ten finishes in catalog order', () => {
    expect(keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES, sideCount: 2 }))).toEqual(
      ALL_TEN,
    );
  });

  it('drops the two-sides-only finishes from a three-side build', () => {
    const keys = keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES, sideCount: 3 }));
    expect(keys).toEqual(ALL_TEN.filter((key) => !TWO_SIDE_ONLY.includes(key)));
  });

  it("falls back to the match type's minimum side count", () => {
    expect(finishSideCount(TEST_CATALOGS, { matchTypeKey: TRIPLE_THREAT })).toBe(3);
    expect(finishSideCount(TEST_CATALOGS, { matchTypeKey: parseContentKey('match.cage') })).toBe(2);
    const keys = keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: TRIPLE_THREAT }));
    expect(keys).not.toContain('finish.count-out');
    expect(keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES }))).toEqual(ALL_TEN);
  });

  it('honours matchTypes.only', () => {
    const catalogs = withFinish('finish.flash', (finish) => ({
      ...finish,
      matchTypes: { only: [TAG] },
    }));
    expect(keysOf(allowedFinishes(catalogs, { matchTypeKey: SINGLES }))).not.toContain(
      'finish.flash',
    );
    expect(keysOf(allowedFinishes(catalogs, { matchTypeKey: TAG }))).toContain('finish.flash');
  });

  it('honours matchTypes.except', () => {
    const catalogs = withFinish('finish.stalemate', (finish) => ({
      ...finish,
      matchTypes: { except: [SINGLES] },
    }));
    expect(keysOf(allowedFinishes(catalogs, { matchTypeKey: SINGLES }))).not.toContain(
      'finish.stalemate',
    );
    expect(keysOf(allowedFinishes(catalogs, { matchTypeKey: TAG }))).toContain('finish.stalemate');
  });

  it('is empty without a finish catalog', () => {
    expect(allowedFinishes({}, { matchTypeKey: SINGLES })).toEqual([]);
  });
});

describe('registerFinishFilter', () => {
  it('runs a filter that removes an entry, with the context filled in', () => {
    const seen: unknown[] = [];
    unregisters.push(
      registerFinishFilter({
        id: 'test.no-flash',
        order: 10,
        filter: (entries, ctx) => {
          seen.push(ctx);
          return entries.filter((entry) => entry.key !== 'finish.flash');
        },
      }),
    );
    const keys = keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES }));
    expect(keys).toEqual(ALL_TEN.filter((key) => key !== 'finish.flash'));
    expect(seen).toEqual([{ matchTypeKey: SINGLES, sideCount: 2, stipulationKeys: [] }]);
  });

  it('runs filters in order, then by id', () => {
    const calls: string[] = [];
    const recorder = (id: string, order: number) =>
      registerFinishFilter({
        id,
        order,
        filter: (entries) => {
          calls.push(id);
          return entries;
        },
      });
    unregisters.push(recorder('test.b', 5), recorder('test.a', 5), recorder('test.first', 1));
    allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES });
    expect(calls).toEqual(['test.first', 'test.a', 'test.b']);
  });

  it('throws naming the filter when a filter adds an entry', () => {
    unregisters.push(
      registerFinishFilter({
        id: 'test.no-draws',
        order: 1,
        filter: (entries) => entries.filter((entry) => entry.outcomeKind !== 'draw'),
      }),
      registerFinishFilter({
        id: 'test.adds-stalemate',
        order: 2,
        filter: (entries) => {
          const stalemate = TEST_CATALOGS.finishes?.[parseContentKey('finish.stalemate')];
          return stalemate === undefined ? entries : [...entries, stalemate];
        },
      }),
    );
    expect(() => allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES })).toThrow(RegistryError);
    expect(() => allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES })).toThrow(
      /test\.adds-stalemate/,
    );
  });

  it('refuses a duplicate id', () => {
    const filter: FinishFilter = { id: 'test.twice', order: 1, filter: (entries) => entries };
    unregisters.push(registerFinishFilter(filter));
    expect(() => registerFinishFilter(filter)).toThrow(RegistryError);
  });

  it('restores the list once unregistered', () => {
    const unregister = registerFinishFilter({
      id: 'test.only-clean',
      order: 1,
      filter: (entries) => entries.filter((entry) => entry.key === 'finish.clean'),
    });
    expect(keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES }))).toEqual([
      'finish.clean',
    ]);
    unregister();
    expect(keysOf(allowedFinishes(TEST_CATALOGS, { matchTypeKey: SINGLES }))).toEqual(ALL_TEN);
  });
});
