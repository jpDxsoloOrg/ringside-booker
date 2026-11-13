// The card pool. Design: docs/design/rival-booking.md#card-pool
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../../src/core/content-key';
import { addDays } from '../../../../src/core/date';
import type { PersonId } from '../../../../src/core/ids';
import type { EventImportance } from '../../../../src/model/entities/event-definition';
import { compareIds } from '../../../../src/model/table';
import { buildCardPool, type CardPool } from '../../../../src/systems/aip';
import { createEngineTunables } from '../../../../src/systems/tunables';
import { aTeam } from '../../../support/builders/promotions';
import { anEventInstance } from '../../../support/builders/creative';
import { flatAttributes } from '../../../support/builders/people';
import { TEST_START_DATE } from '../../../support/builders/build-row';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';
import { worldBuilder, type BuiltWorld } from '../../../support/world-builder';

const TODAY = TEST_START_DATE; // Mon 5 Jan 2026
const tunables = createEngineTunables();

/**
 * Promotion A (computer) with two brands and 12 wrestlers on the first brand:
 *
 * 0 champion · 1 injured (leg, no talking) until 12 Feb · 2 injured (arm) but can talk ·
 * 3 suspended · 4 not debuted · 5 tired (fatigue 82) · 6 used 24 of 24 appearances ·
 * 7 no house shows · 8 and 9 moved to the second brand · 10 brandless · 11 the best of them.
 *
 * Teams: 0 + 11 (fit), 2 + 10 (an injured member), 11 + 8 (another brand's member), and a split
 * team 0 + 7.
 */
function poolWorld(): BuiltWorld {
  return worldBuilder()
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'computer' } }, (promotion) =>
      promotion
        .withBrand({ name: 'Test Brand One' })
        .withBrand({ name: 'Test Brand Two' })
        .withRoster(12, {
          person: (index) => {
            switch (index) {
              case 1:
                return {
                  injury: {
                    kindKey: parseContentKey('injury.test'),
                    bodyPart: 'legs',
                    since: addDays(TODAY, -3),
                    expectedReturn: addDays(TODAY, 38),
                    canWorkAngles: false,
                  },
                };
              case 2:
                return {
                  injury: {
                    kindKey: parseContentKey('injury.test'),
                    bodyPart: 'arms',
                    since: addDays(TODAY, -3),
                    expectedReturn: addDays(TODAY, 20),
                    canWorkAngles: true,
                  },
                };
              case 4:
                return { debutDate: addDays(TODAY, 30) };
              case 5:
                return { fatigue: 82 };
              case 11:
                return { attributes: flatAttributes(90) };
              default:
                return {};
            }
          },
          employment: (index) => {
            switch (index) {
              case 3:
                return { leave: { kind: 'suspension', until: addDays(TODAY, 10), paid: false } };
              case 6:
                return { terms: { appearanceCap: 24 }, appearancesThisYear: 24 };
              case 7:
                return { terms: { perks: { noHouseShows: true } } };
              default:
                return {};
            }
          },
        })
        .withTitle({ name: 'Test Title' }, { holder: 0 }),
    )
    .with('brands, teams and shows', (context) => {
      const { people, employments, brands } = context.ids;
      const [first, second] = brands;
      const person = (index: number): PersonId => {
        const id = people[index];
        if (id === undefined) {
          throw new Error(`no person ${String(index)}`);
        }
        return id;
      };
      for (const index of [8, 9]) {
        const employmentId = employments[index];
        if (employmentId !== undefined && second !== undefined) {
          context.tx.update('employments', employmentId, { brandId: second });
        }
      }
      const brandless = employments[10];
      if (brandless !== undefined) {
        context.tx.update('employments', brandless, { brandId: null });
      }
      for (const [left, right] of [
        [0, 11],
        [2, 10],
        [11, 8],
      ] as const) {
        context.insert(
          'teams',
          aTeam({ memberIds: [person(left), person(right)] }, context.sequence),
        );
      }
      context.insert(
        'teams',
        aTeam(
          { memberIds: [person(0), person(7)], status: 'split', splitOn: TODAY },
          context.sequence,
        ),
      );
      const promotionId = context.ids.promotions.A;
      const [regionId] = context.ids.regions;
      if (promotionId === undefined || regionId === undefined || first === undefined) {
        throw new Error('the pool world needs a promotion, a region and a brand');
      }
      for (const importance of ['regular', 'house'] as const) {
        context.insert(
          'eventInstances',
          anEventInstance(
            { promotionId, regionId, brandId: first, importance, date: TODAY },
            context.sequence,
          ),
        );
      }
    })
    .build();
}

function poolFor(built: BuiltWorld, importance: EventImportance = 'regular'): CardPool {
  const instance = built.world.tables.eventInstances
    .values()
    .find((row) => row.importance === importance);
  if (instance === undefined) {
    throw new Error(`no ${importance} show`);
  }
  const pool = buildCardPool(built.world, { instance, date: TODAY, tunables });
  expectSerialisable(pool);
  return pool;
}

function idOf(built: BuiltWorld, index: number): PersonId {
  const id = built.ids.people[index];
  if (id === undefined) {
    throw new Error(`no person ${String(index)}`);
  }
  return id;
}

function reasonOf(pool: CardPool, personId: PersonId): string | undefined {
  return pool.excluded.find((entry) => entry.personId === personId)?.reason;
}

describe('buildCardPool', () => {
  const built = poolWorld();
  const pool = poolFor(built);
  const candidate = (index: number) =>
    pool.candidates.find((entry) => entry.personId === idOf(built, index));

  it('leaves out injured, suspended and not-debuted workers with readable reasons', () => {
    expect(candidate(1)).toBeUndefined();
    expect(reasonOf(pool, idOf(built, 1))).toBe('Injured (leg injury) until 12 Feb');
    expect(candidate(3)).toBeUndefined();
    expect(reasonOf(pool, idOf(built, 3))).toBe('Suspended until 15 Jan');
    expect(candidate(4)).toBeUndefined();
    expect(reasonOf(pool, idOf(built, 4))).toBe('Has not debuted yet (debuts 4 Feb)');
  });

  it('keeps an injured worker who can still talk, for talking only', () => {
    expect(candidate(2)).toMatchObject({ canTalk: true, canWrestle: false });
    expect(reasonOf(pool, idOf(built, 2))).toBe(
      'Injured (arm injury) until 25 Jan; can still do talking segments',
    );
  });

  it('flags tired and contract-blocked workers as a last resort', () => {
    expect(candidate(5)).toMatchObject({ canWrestle: true, restedEnough: false, fatigue: 82 });
    expect(reasonOf(pool, idOf(built, 5))).toBe('Tired (fatigue 82, limit 75)');
    expect(candidate(6)).toMatchObject({ canWrestle: true, contractBlock: 'appearanceCap' });
    expect(reasonOf(pool, idOf(built, 6))).toBe('Used 24 of 24 contracted appearances');
    expect(candidate(7)?.contractBlock).toBeNull();
    expect(reasonOf(pool, idOf(built, 7))).toBeUndefined();

    const house = poolFor(built, 'house');
    const housePerson = house.candidates.find((entry) => entry.personId === idOf(built, 7));
    expect(housePerson?.contractBlock).toBe('noHouseShows');
    expect(reasonOf(house, idOf(built, 7))).toBe('Contract: no house shows');
  });

  it("leaves out another brand's workers and keeps brandless ones", () => {
    expect(candidate(8)).toBeUndefined();
    expect(candidate(9)).toBeUndefined();
    expect(reasonOf(pool, idOf(built, 8))).toBeUndefined();
    expect(candidate(10)).toMatchObject({ canWrestle: true, canTalk: true });
  });

  it('counts the wrestlers fit to work', () => {
    // 0, 7, 10 and 11; 5 is tired and 6 has used up their appearances.
    expect(pool.availableWrestlers).toBe(4);
    // On the house show 7's contract rules them out too.
    expect(poolFor(built, 'house').availableWrestlers).toBe(3);
  });

  it('keeps only active teams whose members can all wrestle', () => {
    expect(pool.teams.map((team) => team.memberIds)).toEqual([[idOf(built, 0), idOf(built, 11)]]);
    const [team] = pool.teams;
    const values = [candidate(0), candidate(11)].map((entry) => entry?.cardValue.value ?? 0);
    expect(team?.meanCardValue).toBeCloseTo((values[0] ?? 0) / 2 + (values[1] ?? 0) / 2);
    expect(candidate(0)?.teamIds).toEqual([team?.teamId]);
    expect(candidate(2)?.teamIds).toEqual([]);
  });

  it('lists the titles and marks their champions', () => {
    expect(pool.titles).toHaveLength(1);
    expect(pool.titles[0]).toMatchObject({
      name: 'Test Title',
      holderIds: [idOf(built, 0)],
      holderCount: 1,
    });
    expect(candidate(0)?.championOf).toEqual([pool.titles[0]?.titleId]);
    expect(candidate(11)?.championOf).toEqual([]);
  });

  it('traces card value and talking ability', () => {
    for (const entry of pool.candidates) {
      expectTraceReplays(entry.cardValue);
      expectTraceReplays(entry.talkValue);
    }
    expect(candidate(11)?.talkValue.value).toBe(90);
  });

  it('sorts by card value, then person ID, the same way every build', () => {
    const order = pool.candidates.map((entry) => entry.personId);
    expect(order[0]).toBe(idOf(built, 11));
    const sorted = [...pool.candidates].sort(
      (left, right) =>
        right.cardValue.value - left.cardValue.value || compareIds(left.personId, right.personId),
    );
    expect(order).toEqual(sorted.map((entry) => entry.personId));
    expect(poolFor(poolWorld())).toEqual(pool);
  });

  it('carries the booker taste the shape formulas read', () => {
    expect(pool.taste.values.talkShare).toBeGreaterThanOrEqual(0);
    expect(pool.taste.values.talkShare).toBeLessThanOrEqual(100);
    expect(pool.importance).toBe('regular');
  });
});
