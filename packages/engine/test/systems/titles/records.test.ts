// A title's records and vacancy days (CRTV1-02). Design: docs/design/titles.md#records
import { describe, expect, it } from 'vitest';
import { addDays, addYears, type GameDate } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import {
  daysVacant,
  titleRecords,
  type TitleRecordPerson,
  type TitleRecordReign,
} from '../../../src/systems/titles';
import { testId } from '../../support/ids';
import { START } from './titles-world';

const TODAY = addDays(START, 200);

const ANA = testId('person', 1);
const BEA = testId('person', 2);
const CAL = testId('person', 3);
const DEX = testId('person', 4);

function day(offset: number): GameDate {
  return addDays(START, offset);
}

function reign(
  number: number,
  holderIds: readonly PersonId[],
  wonOn: number,
  lostOn: number | null,
  defences = 0,
): TitleRecordReign {
  return {
    id: testId('titleReign', number),
    holderIds,
    label: `Reign ${String(number)}`,
    wonOn: day(wonOn),
    lostOn: lostOn === null ? null : day(lostOn),
    defences,
  };
}

function person(ringName: string, age: number): TitleRecordPerson {
  return { ringName, birthDate: addYears(START, -age) };
}

const PEOPLE = new Map<PersonId, TitleRecordPerson>([
  [ANA, person('Ana', 30)],
  [BEA, person('Bea', 41)],
  [CAL, person('Cal', 24)],
  [DEX, person('Dex', 35)],
]);

describe('titleRecords', () => {
  // Hand count: Ana 0-50 (50 days, 2 def), Bea 50-60 (10, 0), Ana 60-130 (70, 5),
  // Cal & Dex 130-140 (10, 1), Cal 150-today (50 days to day 200, 0).
  const lineage = [
    reign(1, [ANA], 0, 50, 2),
    reign(2, [BEA], 50, 60),
    reign(3, [ANA], 60, 130, 5),
    reign(4, [CAL, DEX], 130, 140, 1),
    reign(5, [CAL], 150, null),
  ];
  const records = titleRecords(lineage, PEOPLE, TODAY);

  it('finds the longest reign, counting the current one to today', () => {
    expect(records.longestReign).toEqual({
      value: 70,
      label: 'Reign 3',
      personIds: [ANA],
      reignIds: [testId('titleReign', 3)],
    });
  });

  it('finds the shortest finished reign, ties to the earliest won', () => {
    // Reigns 2 and 4 both lasted 10 days; reign 2 was won first.
    expect(records.shortestReign?.value).toBe(10);
    expect(records.shortestReign?.reignIds).toEqual([testId('titleReign', 2)]);
  });

  it('finds the most defences in one reign', () => {
    expect(records.mostDefences?.value).toBe(5);
    expect(records.mostDefences?.reignIds).toEqual([testId('titleReign', 3)]);
  });

  it('counts reigns per person, a tag reign for both holders', () => {
    // Ana 2 reigns, Cal 2 (tag and singles): Ana won first, so the tie is hers.
    expect(records.mostReigns).toEqual({
      value: 2,
      label: 'Ana',
      personIds: [ANA],
      reignIds: [testId('titleReign', 1), testId('titleReign', 3)],
    });
  });

  it('adds up combined days per person', () => {
    expect(records.mostCombinedDays?.value).toBe(120);
    expect(records.mostCombinedDays?.personIds).toEqual([ANA]);
    // Dex's only days come from the tag reign.
    const dexOnly = titleRecords([reign(4, [CAL, DEX], 130, 140)], PEOPLE, TODAY);
    expect(dexOnly.mostCombinedDays?.value).toBe(10);
    expect(dexOnly.mostCombinedDays?.personIds).toEqual([CAL]);
  });

  it('finds the oldest and youngest champions by age on the day they won', () => {
    expect(records.oldestChampion).toEqual({
      value: 41,
      label: 'Bea',
      personIds: [BEA],
      reignIds: [testId('titleReign', 2)],
    });
    expect(records.youngestChampion?.value).toBe(24);
    expect(records.youngestChampion?.personIds).toEqual([CAL]);
    // Cal was 24 at both wins; the earlier win (the tag reign) holds the record.
    expect(records.youngestChampion?.reignIds).toEqual([testId('titleReign', 4)]);
  });

  it('skips people it knows nothing about for the age records', () => {
    const unknown = testId('person', 99);
    const only = titleRecords([reign(1, [unknown], 0, null)], PEOPLE, TODAY);
    expect(only.oldestChampion).toBeNull();
    expect(only.youngestChampion).toBeNull();
    expect(only.mostReigns?.label).toBe(unknown);
  });

  it('has no shortest reign while nobody has lost it', () => {
    const current = titleRecords([reign(1, [ANA], 0, null, 3)], PEOPLE, TODAY);
    expect(current.shortestReign).toBeNull();
    expect(current.longestReign?.value).toBe(200);
    expect(current.mostDefences?.value).toBe(3);
  });

  it('breaks a tie between reigns won on the same day by the lowest id', () => {
    const sameDay = titleRecords(
      [reign(7, [ANA], 0, 10), reign(6, [BEA], 0, 10)],
      PEOPLE,
      TODAY,
    );
    expect(sameDay.longestReign?.reignIds).toEqual([testId('titleReign', 6)]);
  });

  it('has no records at all for a title never held', () => {
    expect(titleRecords([], PEOPLE, TODAY)).toEqual({
      longestReign: null,
      shortestReign: null,
      mostDefences: null,
      mostReigns: null,
      mostCombinedDays: null,
      oldestChampion: null,
      youngestChampion: null,
    });
  });
});

describe('daysVacant', () => {
  it('counts the gaps between reigns and before the first', () => {
    // Introduced day 0; vacant 0-10, held 10-50, vacant 50-60, held 60-100, vacant 100-120.
    const reigns = [
      { wonOn: day(10), lostOn: day(50) },
      { wonOn: day(60), lostOn: day(100) },
    ];
    expect(daysVacant(reigns, day(0), day(120))).toBe(40);
  });

  it('counts nothing while a reign has run since the title was introduced', () => {
    expect(daysVacant([{ wonOn: day(0), lostOn: null }], day(0), day(90))).toBe(0);
  });

  it('counts every day for a title never held', () => {
    expect(daysVacant([], day(0), day(30))).toBe(30);
  });

  it('ignores the part of a reign before the title was introduced', () => {
    expect(daysVacant([{ wonOn: day(-20), lostOn: day(5) }], day(0), day(30))).toBe(25);
  });

  it('does not count overlapping spans twice', () => {
    const reigns = [
      { wonOn: day(0), lostOn: day(20) },
      { wonOn: day(10), lostOn: day(30) },
    ];
    expect(daysVacant(reigns, day(0), day(40))).toBe(10);
  });
});
