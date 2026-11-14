// Contracts on the news wire (DAY1-06): notable signings and departures, and a rival's refused
// release once AIP1 reveals it. Design: docs/design/news.md#integration
import { describe, expect, it } from 'vitest';
import { parseGameDate } from '../../../src/core/date';
import { parseContentKey } from '../../../src/core/content-key';
import type { EmploymentId, PersonId, PromotionId } from '../../../src/core/ids';
import type { Push } from '../../../src/model/entities/employment';
import type { GameWorld } from '../../../src/model/tables';
import { aipSystem, writeAiDecision } from '../../../src/systems/aip';
import {
  DEPARTURE_TOPIC,
  RELEASE_DECISION_KIND,
  RELEASE_REFUSED_SUMMARY_KEY,
  RELEASE_REFUSED_TOPIC,
  RELEASE_TOPIC,
  SIGNING_TOPIC,
  WALKED_OUT_TOPIC,
  contractNewsDedupeKey,
  contractsSystem,
} from '../../../src/systems/contracts';
import { testId, worldBuilder } from '../../support';
import { allStories, newsWire, storiesWithTopic } from '../../support/news-wire';

/** Every mini region at the same value, so the worldwide figure is that value. */
function everywhere(value: number): Record<string, number> {
  return Object.fromEntries([1, 2, 3, 4].map((serial) => [testId('region', serial), value]));
}

/** Who is on the roster: push and worldwide popularity, and the contract's status. */
const ROSTER: readonly { push: Push; pop: number; status: 'active' | 'released' }[] = [
  { push: 'mainEvent', pop: 20, status: 'active' }, // 0: importance 2 by push
  { push: 'upperCard', pop: 20, status: 'active' }, // 1: importance 1 by push
  { push: 'midCard', pop: 45, status: 'active' }, // 2: importance 1 by popularity
  { push: 'lowerCard', pop: 65, status: 'active' }, // 3: importance 2 by popularity
  { push: 'midCard', pop: 20, status: 'active' }, // 4: not notable
  { push: 'upperCard', pop: 20, status: 'released' }, // 5: released
];

interface ContractWorld {
  readonly world: GameWorld;
  readonly promotion: PromotionId;
  readonly people: readonly PersonId[];
  readonly employments: readonly EmploymentId[];
}

function contractWorld(): ContractWorld {
  const { world, ids } = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Test Promotion A' }, (promotion) =>
      promotion.withRoster(ROSTER.length, {
        person: (index) => ({ regionalPop: everywhere(ROSTER[index]?.pop ?? 0) }),
        employment: (index) => ({
          push: ROSTER[index]?.push ?? 'midCard',
          status: ROSTER[index]?.status ?? 'active',
          ...(ROSTER[index]?.status === 'released' ? { endedOn: parseGameDate('2026-01-05') } : {}),
        }),
      }),
    )
    .build();
  const promotion = ids.promotions.A;
  if (promotion === undefined) throw new Error('no promotion');
  const people = ids.people.slice(0, ROSTER.length);
  const employments = people.map((personId) => {
    const employment = world.tables.employments.lookup('byPerson', personId)[0];
    if (employment === undefined) throw new Error('no contract');
    return employment.id;
  });
  return { world, promotion, people, employments };
}

function ref(built: ContractWorld, index: number) {
  const personId = built.people[index];
  const employmentId = built.employments[index];
  if (personId === undefined || employmentId === undefined) throw new Error('no such worker');
  return { employmentId, personId, promotionId: built.promotion };
}

describe('contracts on the news wire', () => {
  it('posts a signing for notable workers only, with importance by push and popularity', async () => {
    const built = contractWorld();
    const wire = newsWire(built.world, [contractsSystem]);
    for (const index of [0, 1, 2, 3, 4]) {
      wire.events.push({ type: 'contract.started', payload: ref(built, index) });
    }
    await wire.engine.advanceDays({ maxDays: 1 });

    // Stories are stored in id order, and ids are random: sort by worker.
    const signings = storiesWithTopic(wire.engine, SIGNING_TOPIC).sort((left, right) =>
      String(left.refs.personIds[0]).localeCompare(String(right.refs.personIds[0])),
    );
    expect(
      signings.map((story) => [story.refs.personIds[0], story.importance, story.kind]),
    ).toEqual([
      [built.people[0], 2, 'signing'],
      [built.people[1], 1, 'signing'],
      [built.people[2], 1, 'signing'],
      [built.people[3], 2, 'signing'],
    ]);
    expect(signings[0]).toMatchObject({
      headline: { params: { personId: built.people[0], promotionId: built.promotion } },
      refs: { promotionIds: [built.promotion], employmentId: built.employments[0] },
      dedupeKey: contractNewsDedupeKey(SIGNING_TOPIC, ref(built, 0).employmentId),
    });
    // Public facts only: who and where, never money.
    expect(Object.keys(signings[0]?.headline.params ?? {}).sort()).toEqual([
      'personId',
      'promotionId',
    ]);
  });

  it('tells a release, an expiry, a granted release and a walk-out, but not an exclusive move', async () => {
    const built = contractWorld();
    const wire = newsWire(built.world, [contractsSystem]);
    wire.events.push(
      {
        type: 'contract.released',
        payload: { ...ref(built, 5), severance: 1000, source: 'player', mutual: false },
      },
      { type: 'contract.expired', payload: { ...ref(built, 0), reasonKey: 'contracts.endDate' } },
      { type: 'contract.quit', payload: { ...ref(built, 1), how: 'granted', severance: 0 } },
      { type: 'contract.quit', payload: { ...ref(built, 2), how: 'walkedOut', severance: 0 } },
      { type: 'contract.quit', payload: { ...ref(built, 3), how: 'exclusiveDeal', severance: 0 } },
      // An active contract: a withdrawn deal or a stale event, so nothing.
      {
        type: 'contract.released',
        payload: { ...ref(built, 1), severance: 0, source: 'player', mutual: false },
      },
    );
    await wire.engine.advanceDays({ maxDays: 1 });

    const byTopic = (topic: string) =>
      storiesWithTopic(wire.engine, topic)
        .map((story) => String(story.refs.personIds[0]))
        .sort();
    expect(byTopic(RELEASE_TOPIC)).toEqual([built.people[5]]);
    expect(byTopic(DEPARTURE_TOPIC)).toEqual([built.people[0], built.people[1]]);
    expect(byTopic(WALKED_OUT_TOPIC)).toEqual([built.people[2]]);
    // Monday's career milestones aside, four stories, all releases.
    const contractStories = allStories(wire.engine).filter((story) => story.kind !== 'milestone');
    expect(contractStories.map((story) => story.kind)).toEqual([
      'release',
      'release',
      'release',
      'release',
    ]);
  });

  it('posts each story once when the event comes again', async () => {
    const built = contractWorld();
    const wire = newsWire(built.world, [contractsSystem]);
    wire.events.push({ type: 'contract.started', payload: ref(built, 0) });
    await wire.engine.advanceDays({ maxDays: 1 });
    wire.events.push({ type: 'contract.started', payload: ref(built, 0) });
    await wire.engine.advanceDays({ maxDays: 1 });
    expect(storiesWithTopic(wire.engine, SIGNING_TOPIC)).toHaveLength(1);
  });

  it("tells a rival's refused release on the day AIP1 reveals it, never before", async () => {
    const built = contractWorld();
    const wire = newsWire(built.world, [aipSystem, contractsSystem]);
    const worker = ref(built, 1);
    const revealOn = parseGameDate('2026-01-08');
    wire.steps.push((ctx) => {
      expect(ctx.date).toBe('2026-01-05');
      writeAiDecision(
        ctx.tx,
        ctx,
        { promotionId: built.promotion, brandId: null, key: built.promotion },
        {
          kind: RELEASE_DECISION_KIND,
          summary: {
            key: parseContentKey(RELEASE_REFUSED_SUMMARY_KEY),
            params: { name: 'Test Worker', reason: 'Champions are always kept' },
          },
          refs: { personIds: [worker.personId], employmentIds: [worker.employmentId] },
          revealOn,
          importance: 1,
        },
      );
    });
    await wire.engine.advanceDays({ maxDays: 3 });
    expect(wire.engine.exportState().world.meta.currentDate).toBe(revealOn);
    expect(storiesWithTopic(wire.engine, RELEASE_REFUSED_TOPIC)).toEqual([]);

    await wire.engine.advanceDays({ maxDays: 1 });
    const [story, ...others] = storiesWithTopic(wire.engine, RELEASE_REFUSED_TOPIC);
    expect(others).toEqual([]);
    expect(story).toMatchObject({
      date: revealOn,
      kind: 'rumour',
      importance: 1,
      headline: { params: { personId: worker.personId, promotionId: built.promotion } },
      refs: { personIds: [worker.personId], promotionIds: [built.promotion] },
    });
    // Its reason and the worker's ring name stay in the rival's decision log.
    expect(Object.keys(story?.headline.params ?? {}).sort()).toEqual(['personId', 'promotionId']);
  });
});
