/**
 * Contracts on the news wire (DAY1-06, wiring ECO4 into DAY1): signings and departures of the
 * workers people care about, through `postNews`.
 *
 * - `contract.started` posts a `signing` story (topic `signing`).
 * - `contract.released` posts a `release` story (topic `release`): the promotion let them go. A
 *   signed deal withdrawn before it started posts nothing; the worker never arrived.
 * - `contract.expired` and a release granted at the worker's request (`contract.quit`, `granted`)
 *   post a `release` story (topic `departure`): they have left. A walk-out posts topic
 *   `walked-out`. Leaving for an exclusive deal elsewhere posts nothing here: the new promotion's
 *   `signing` story tells it.
 * - A rival's refused release request becomes a `rumour` story (topic `release-refused`) on the
 *   day AIP1 reveals the decision (its contract's end), through `registerDecisionNews`.
 *
 * Only notable workers make a story: a push of upper card or main event, or worldwide popularity
 * of {@link NOTABLE_WORLD_POPULARITY} or more. Importance 2 for a main eventer or
 * {@link STAR_WORLD_POPULARITY} or more, else 1. Stories carry who and where only, never wages,
 * severance or a promotion's money (D-07), and never what a player was asked privately: a
 * request the player refused is not news.
 *
 * Design: docs/design/news.md#integration.
 */

import { defineSubscription } from '../../core/api/system';
import type { EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { StepContext } from '../../core/pipeline/context';
import type { NewsImportance, NewsKind } from '../../model/entities/news';
import { registerDecisionNews } from '../aip/news';
import { postNews } from '../news/post';
import { registerNewsTopic } from '../news/topics';
import { popularityRollup } from '../world/formulas/popularityRollup';
import { geographyOf } from '../world/geography';
import { RELEASE_DECISION_KIND, RELEASE_REFUSED_SUMMARY_KEY } from './decisionLog';

export const SIGNING_TOPIC = 'signing';
export const RELEASE_TOPIC = 'release';
export const DEPARTURE_TOPIC = 'departure';
export const WALKED_OUT_TOPIC = 'walked-out';
export const RELEASE_REFUSED_TOPIC = 'release-refused';

for (const topic of [
  SIGNING_TOPIC,
  RELEASE_TOPIC,
  DEPARTURE_TOPIC,
  WALKED_OUT_TOPIC,
  RELEASE_REFUSED_TOPIC,
]) {
  registerNewsTopic(topic, { params: ['personId', 'promotionId'] });
}

/** Worldwide popularity from which any signing or departure is news. Story beats, not balance. */
export const NOTABLE_WORLD_POPULARITY = 40;
/** Worldwide popularity from which the story is importance 2. */
export const STAR_WORLD_POPULARITY = 60;

export const CONTRACT_NEWS_SUBSCRIPTION_IDS = {
  started: 'contracts.newsOnStarted',
  released: 'contracts.newsOnReleased',
  expired: 'contracts.newsOnExpired',
  quit: 'contracts.newsOnQuit',
} as const;

/** `<topic>:<employmentId>`: one story per contract and topic. */
export function contractNewsDedupeKey(topic: string, employmentId: EmploymentId): string {
  return `${topic}:${employmentId}`;
}

/**
 * The story's importance for the worker on that contract, or null when they are not notable: a
 * push below upper card and worldwide popularity under {@link NOTABLE_WORLD_POPULARITY}.
 */
export function contractNewsImportance(
  read: StepContext['read'],
  employmentId: EmploymentId,
): NewsImportance | null {
  const employment = read.tables.employments.get(employmentId);
  const person = employment === undefined ? undefined : read.tables.people.get(employment.personId);
  if (employment === undefined || person === undefined) {
    return null;
  }
  const popularity = popularityRollup(person.regionalPop, geographyOf(read)).world.value;
  if (employment.push === 'mainEvent' || popularity >= STAR_WORLD_POPULARITY) {
    return 2;
  }
  if (employment.push === 'upperCard' || popularity >= NOTABLE_WORLD_POPULARITY) {
    return 1;
  }
  return null;
}

interface ContractStory {
  readonly kind: NewsKind;
  readonly topic: string;
  readonly employmentId: EmploymentId;
  readonly personId: PersonId;
  readonly promotionId: PromotionId;
}

function postContractStory(ctx: StepContext, story: ContractStory): void {
  const importance = contractNewsImportance(ctx.read, story.employmentId);
  if (importance === null) {
    return;
  }
  postNews(ctx, {
    kind: story.kind,
    topic: story.topic,
    params: { personId: story.personId, promotionId: story.promotionId },
    refs: {
      personIds: [story.personId],
      promotionIds: [story.promotionId],
      employmentId: story.employmentId,
    },
    importance,
    dedupeKey: contractNewsDedupeKey(story.topic, story.employmentId),
  });
}

export const contractsNewsSubscriptions = [
  defineSubscription({
    id: CONTRACT_NEWS_SUBSCRIPTION_IDS.started,
    type: 'contract.started',
    handler: (event, ctx) => {
      postContractStory(ctx, { kind: 'signing', topic: SIGNING_TOPIC, ...event.payload });
    },
  }),
  defineSubscription({
    id: CONTRACT_NEWS_SUBSCRIPTION_IDS.released,
    type: 'contract.released',
    handler: (event, ctx) => {
      if (ctx.read.tables.employments.get(event.payload.employmentId)?.status !== 'released') {
        return;
      }
      postContractStory(ctx, { kind: 'release', topic: RELEASE_TOPIC, ...event.payload });
    },
  }),
  defineSubscription({
    id: CONTRACT_NEWS_SUBSCRIPTION_IDS.expired,
    type: 'contract.expired',
    handler: (event, ctx) => {
      postContractStory(ctx, { kind: 'release', topic: DEPARTURE_TOPIC, ...event.payload });
    },
  }),
  defineSubscription({
    id: CONTRACT_NEWS_SUBSCRIPTION_IDS.quit,
    type: 'contract.quit',
    handler: (event, ctx) => {
      if (event.payload.how === 'exclusiveDeal') {
        return;
      }
      const topic = event.payload.how === 'walkedOut' ? WALKED_OUT_TOPIC : DEPARTURE_TOPIC;
      postContractStory(ctx, { kind: 'release', topic, ...event.payload });
    },
  }),
];

// A rival's refused release request, once AIP1 reveals it (the contract's end).
registerDecisionNews({
  decisionKind: RELEASE_DECISION_KIND,
  story: (decision) => {
    const personId = decision.refs.personIds[0];
    if (decision.summary.key !== RELEASE_REFUSED_SUMMARY_KEY || personId === undefined) {
      return null;
    }
    return {
      kind: 'rumour',
      topic: RELEASE_REFUSED_TOPIC,
      params: { personId, promotionId: decision.promotionId },
      refs: {
        personIds: [personId],
        promotionIds: [decision.promotionId],
        employmentId: decision.refs.employmentIds[0] ?? null,
      },
    };
  },
});
