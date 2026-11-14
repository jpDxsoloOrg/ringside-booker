import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { TitleDetail } from '@ringside/engine';
import {
  registerTitleDetailSection,
  titleDetailSections,
  visibleTitleDetailSections,
} from './titleDetailSections';
import type { TitleDetailSection } from './titleDetailSections';

/** A vacant title with no reigns: the sections under test never read it. */
const DETAIL: TitleDetail = {
  title: {
    titleId: parseId('title', 'tit_0000000001'),
    name: 'Test Title',
    promotionId: parseId('promotion', 'pro_0000000001'),
    promotionName: 'Test Promotion',
    brandId: null,
    brandName: null,
    holderCount: 1,
    division: { gender: 'open', minWeightKg: null, maxWeightKg: null },
    divisionLabel: 'Open',
    prestige: 50,
    prestigeTraceRef: null,
    prestigeTrace: { kind: 'input', label: 'Prestige', value: 50 },
    status: 'active',
    introducedOn: parseGameDate('2027-01-04'),
    retiredOn: null,
    imageRef: null,
    color: '#c9a227',
    editable: false,
    champion: null,
  },
  reigns: [],
  records: {
    longestReign: null,
    shortestReign: null,
    mostDefences: null,
    mostReigns: null,
    mostCombinedDays: null,
    oldestChampion: null,
    youngestChampion: null,
  },
  stats: {
    totalReigns: 0,
    distinctChampions: 0,
    daysVacant: 0,
    daysVacantTrace: { kind: 'input', label: 'Days vacant', value: 0 },
    historyRecordedFrom: null,
  },
};

function section(
  id: string,
  order: number,
  extra: Partial<TitleDetailSection> = {},
): TitleDetailSection {
  return { id, order, column: 'main', render: () => id, ...extra };
}

let removers: (() => void)[] = [];

afterEach(() => {
  for (const remove of removers) remove();
  removers = [];
});

describe('title page sections', () => {
  it('lists registered sections lowest order first, ties in registration order', () => {
    removers = [
      registerTitleDetailSection(section('late', 30)),
      registerTitleDetailSection(section('early', 10)),
      registerTitleDetailSection(section('tie', 30)),
    ];
    expect(titleDetailSections().map((entry) => entry.id)).toEqual(['early', 'late', 'tie']);
  });

  it('throws on a duplicate id', () => {
    removers = [registerTitleDetailSection(section('prestige-history', 10))];
    expect(() => registerTitleDetailSection(section('prestige-history', 20))).toThrow(
      /already registered/,
    );
  });

  it('can be removed again', () => {
    const remove = registerTitleDetailSection(section('temporary', 10));
    remove();
    expect(titleDetailSections()).toEqual([]);
  });

  it('draws only the column asked for and the sections visible for this title', () => {
    removers = [
      registerTitleDetailSection(section('main', 10)),
      registerTitleDetailSection(section('side', 10, { column: 'side' })),
      registerTitleDetailSection(section('hidden', 5, { visible: () => false })),
    ];
    const ids = (column: 'main' | 'side') =>
      visibleTitleDetailSections(titleDetailSections(), column, DETAIL).map((entry) => entry.id);
    expect(ids('main')).toEqual(['main']);
    expect(ids('side')).toEqual(['side']);
  });
});
