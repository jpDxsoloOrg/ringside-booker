// The weekly roster review job (AIP1-05) and the one roster rule it reads.
// Design: docs/design/rival-desk.md#roster-review
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { PersonId } from '../../../src/core/ids';
import { aiUnitKey } from '../../../src/model/entities/ai-profile';
import {
  computerUnits,
  needsInputsFor,
  ROSTER_REVIEW_DECISION_KIND,
  rosterReviewSummaryText,
  unitRoster,
} from '../../../src/systems/aip';
import { createEngineTunables } from '../../../src/systems/tunables';
import { aPerson } from '../../support/builders/people';
import { anEmployment } from '../../support/builders/promotions';
import { COMPUTER, RUNNER_START, runnerWorld, runTurnsFor } from './runner-world';

/** Overrides that leave faces against heels as the only need a roster can have. */
const ONLY_ALIGNMENT = {
  'aip.needs.workersPerSlot': 0,
  'aip.needs.minReferees': 0,
  'aip.needs.minAnnouncers': 0,
};

function decisionsOf(built: ReturnType<typeof runnerWorld>) {
  return built.world.tables.aiDecisions
    .values()
    .filter((decision) => decision.kind === ROSTER_REVIEW_DECISION_KIND);
}

describe('aip.rosterReview', () => {
  it('records exactly one review a week for each computer unit, with a stored Why?', () => {
    const built = runnerWorld();
    runTurnsFor(built.runtime, RUNNER_START, 7);
    const decisions = decisionsOf(built);
    const units = computerUnits(built.world);
    expect(units).toHaveLength(3);
    for (const unit of units) {
      const mine = decisions.filter(
        (decision) => aiUnitKey(decision.promotionId, decision.brandId) === unit.key,
      );
      expect(mine).toHaveLength(1);
      const [review] = mine;
      expect(review?.revealOn).toBe(review?.date);
      expect(review?.importance).toBe(0);
      expect(review?.summary.key).toBe('aip.decision.roster-review');
      expect(review?.traceRef?.kind).toBe('aip.rosterReview');
      if (review?.traceRef === null || review?.traceRef === undefined) {
        return expect.fail('the review has no trace');
      }
      expect(built.runtime.traces.has(review.traceRef)).toBe(true);
    }
    // The human promotion (as a whole) never reviews.
    expect(
      decisions.filter(
        (decision) => decision.promotionId === built.proA && decision.brandId === null,
      ),
    ).toEqual([]);
  });

  it('names "Short on heels" as the most pressing need of 6 faces and 1 heel', () => {
    const built = runnerWorld(
      (builder) =>
        builder.withPromotion({ controller: COMPUTER }, (promotion) =>
          promotion.withRoster(7, {
            employment: (index) => ({
              push: 'midCard',
              alignment: index === 6 ? 'heel' : 'face',
            }),
          }),
        ),
      ONLY_ALIGNMENT,
    );
    const proD = built.ids.promotions.D;
    runTurnsFor(built.runtime, RUNNER_START, 7);
    const [review] = decisionsOf(built).filter((decision) => decision.promotionId === proD);
    if (review === undefined) {
      return expect.fail('promotion D has no review');
    }
    expect(review.summary.params).toEqual({ count: 1, top: 'Short on heels' });
    expect(rosterReviewSummaryText(review.summary)).toBe(
      'Weekly roster review: 1 need, most pressing: Short on heels',
    );
    // The other computer units have no wrestlers, so nothing is pressing.
    const [quiet] = decisionsOf(built).filter((decision) => decision.promotionId === built.proB);
    if (quiet === undefined) {
      return expect.fail('promotion B has no review');
    }
    expect(quiet.summary.params).toEqual({ count: 0 });
    expect(rosterReviewSummaryText(quiet.summary)).toBe('Weekly roster review: no pressing needs');
  });

  it('reviews only its own brand for a brand unit', () => {
    const brandWrestlers: PersonId[] = [];
    const built = runnerWorld((builder) =>
      builder.with('brand roster', (context) => {
        const promotionId = context.ids.promotions.A;
        const brandId = context.ids.brands[1];
        if (promotionId === undefined || brandId === undefined) {
          throw new Error('no computer brand');
        }
        // One wrestler on A's human-run flagship brand, three on its computer GM brand.
        const flagshipId = context.ids.brands[0] ?? null;
        for (let index = 0; index < 4; index += 1) {
          const person = context.insert('people', aPerson({}, context.sequence));
          context.insert(
            'employments',
            anEmployment(
              {
                personId: person.id,
                promotionId,
                brandId: index === 0 ? flagshipId : brandId,
                startsOn: context.meta.startDate,
                offeredOn: context.meta.startDate,
              },
              context.sequence,
            ),
          );
          if (index > 0) {
            brandWrestlers.push(person.id);
          }
        }
      }),
    );
    const flagship = built.ids.brands[0];
    const brandUnit = computerUnits(built.world).find((unit) => unit.brandId !== null);
    if (brandUnit === undefined) {
      return expect.fail('no brand unit');
    }
    const tunables = createEngineTunables();
    const inputs = needsInputsFor(built.world, tunables, brandUnit, RUNNER_START);
    expect(inputs.wrestlers.map((wrestler) => wrestler.personId).sort()).toEqual(
      [...brandWrestlers].sort(),
    );
    expect(unitRoster(built.world, brandUnit, RUNNER_START)).toHaveLength(3);
    // The whole promotion, as the player runs it, has both brands' contracts.
    const whole = { promotionId: built.proA, brandId: null, excludedBrandIds: [] };
    expect(unitRoster(built.world, whole, RUNNER_START)).toHaveLength(4);
    // A computer promotion unit leaves out a brand in excludedBrandIds.
    const excluded = { ...whole, excludedBrandIds: flagship === undefined ? [] : [flagship] };
    expect(unitRoster(built.world, excluded, RUNNER_START)).toHaveLength(3);
  });

  it('writes no rows outside the decision log', () => {
    const built = runnerWorld((builder) =>
      builder.withPromotion({ controller: COMPUTER }, (promotion) =>
        promotion.withRoster(5).withTitle({}, { holder: 0 }),
      ),
    );
    const tables = built.world.tables;
    // `aiProfiles` is the runner's own write (it heals a missing profile and sets `lastTurnOn` on
    // every turn), not the job's.
    const snapshot = (): Record<string, string> =>
      Object.fromEntries(
        Object.entries(tables)
          .filter(([name]) => name !== 'aiDecisions' && name !== 'aiProfiles')
          .map(([name, table]) => [name, JSON.stringify(table.values())]),
      );
    const before = snapshot();
    runTurnsFor(built.runtime, RUNNER_START, 7);
    expect(snapshot()).toEqual(before);
    expect(decisionsOf(built)).toHaveLength(computerUnits(built.world).length);
    // The next week brings one more review each.
    runTurnsFor(built.runtime, addDays(RUNNER_START, 7), 7);
    expect(decisionsOf(built)).toHaveLength(2 * computerUnits(built.world).length);
  });
});
