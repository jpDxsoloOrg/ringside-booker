/**
 * Rival decisions on the news wire (DAY1-06, wiring AIP1 into DAY1).
 *
 * A rival decision with importance 1 or more can become a story, but only on its `revealOn` date,
 * so a plan never leaks before the show it is about has aired (rival-desk.md#visibility). Nothing
 * here listens to `aip.decisionRecorded`: that event fires when the plan is made.
 *
 * The daily `aip.newsFromDecisions` phase (`periodic`, order 38: after the day's shows and
 * contract steps, so a show airing today has aired and every decision written today is on file,
 * and before `aip.pruneDecisionLog` at 42 deletes rows that are revealed and already past the
 * window) reads the decisions revealed today from the `byRevealOn` index, in id order. A decision
 * becomes a story when its kind has a story writer (`registerDecisionNews`) and that writer
 * returns one; the story takes the decision's importance and the dedupe key
 * `aip-decision:<decisionId>`, so a rerun posts nothing new.
 *
 * Kinds opt in, because most rival decisions are already news from the event they lead to: a
 * card plan becomes a `show-result` story when the show runs (or `show-cancelled`), a title plan a
 * `title-change` story, a granted release a `release` story. Writing those again from the
 * decision would post every rival show twice. ECO4 registers its refused releases, which no event
 * makes public.
 *
 * Design: docs/design/news.md#integration and docs/design/rival-desk.md#news.
 */

import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { RegistryError } from '../../core/errors';
import type { AiDecision } from '../../model/entities/ai-decision';
import type { NewsImportance } from '../../model/entities/news';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { postNews, type PostNewsInput } from '../news/post';

export const AIP_NEWS_FROM_DECISIONS_PHASE_ID = 'aip.newsFromDecisions';
/** In `periodic`: after the shows and contracts groups, before `aip.pruneDecisionLog` (42). */
export const AIP_NEWS_FROM_DECISIONS_PHASE_ORDER = 38;

/** The story a revealed decision makes: everything but its importance and dedupe key. */
export type DecisionStory = Omit<PostNewsInput, 'importance' | 'dedupeKey'>;

/** How one decision kind becomes news. */
export interface DecisionNewsSpec {
  /** The registered decision kind, such as `release`. */
  readonly decisionKind: string;
  /** The story for a revealed decision of the kind, or null for none. Read only. */
  readonly story: (
    decision: DeepReadonly<AiDecision>,
    read: GameWorldView,
  ) => DecisionStory | null;
}

const writers = new Map<string, DecisionNewsSpec>();

/**
 * Lets a decision kind become news on its reveal day. Returns a function that removes it again
 * (for tests). Throws `RegistryError` when the kind already has a writer.
 */
export function registerDecisionNews(spec: DecisionNewsSpec): () => void {
  if (writers.has(spec.decisionKind)) {
    throw new RegistryError(`Decision kind "${spec.decisionKind}" already has a news writer`, {
      kind: spec.decisionKind,
    });
  }
  const stored = Object.freeze({ ...spec });
  writers.set(spec.decisionKind, stored);
  return () => {
    if (writers.get(spec.decisionKind) === stored) {
      writers.delete(spec.decisionKind);
    }
  };
}

/** The decision kinds that can become news, sorted. */
export function decisionNewsKinds(): string[] {
  return [...writers.keys()].sort();
}

/** `aip-decision:<decisionId>` */
export function decisionNewsDedupeKey(decisionId: string): string {
  return `aip-decision:${decisionId}`;
}

function newsImportance(importance: number): NewsImportance {
  if (importance >= 3) return 3;
  if (importance === 2) return 2;
  return 1;
}

export const newsFromDecisionsPhase: PhaseDefinition = definePhase({
  id: AIP_NEWS_FROM_DECISIONS_PHASE_ID,
  group: 'periodic',
  order: AIP_NEWS_FROM_DECISIONS_PHASE_ORDER,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    if (writers.size === 0) {
      return;
    }
    const revealed = [...ctx.read.tables.aiDecisions.lookup('byRevealOn', ctx.date)]
      .filter((decision) => decision.importance >= 1 && writers.has(decision.kind))
      .sort((left, right) => compareIds(left.id, right.id));
    let posted = 0;
    for (const decision of revealed) {
      const story = writers.get(decision.kind)?.story(decision, ctx.read) ?? null;
      if (story === null) {
        continue;
      }
      const before = ctx.read.tables.news.size;
      postNews(ctx, {
        ...story,
        importance: newsImportance(decision.importance),
        dedupeKey: decisionNewsDedupeKey(decision.id),
      });
      posted += ctx.read.tables.news.size - before;
    }
    if (posted > 0) {
      ctx.log(`Posted ${String(posted)} stories from rival decisions revealed today`);
    }
  },
});
