/**
 * `aip.rosterReview`: the rival desk's first job. Once a week, on each unit's own weekday, it works
 * out what the unit's roster is short of and records a "Weekly roster review" decision with the
 * review's Why?. It writes nothing else, so it is safe ahead of the features that act on needs
 * (AIP3 pushes, ECO6 hiring).
 *
 * The row stays small (eleven rivals write one a week): a templated summary with the count and the
 * most pressing need, at most 12 IDs per ref list, and a summary-only trace. See
 * docs/design/rival-desk.md#roster-review.
 */

import { parseContentKey } from '../../../core/content-key';
import type { PersonId, TitleId } from '../../../core/ids';
import { AI_DECISION_MAX_REFS } from '../../../model/entities/ai-decision';
import type { TemplatedText } from '../../../model/primitives';
import { ROSTER_REVIEW_DECISION_KIND } from '../decisionKinds';
import { needSummaryText, rosterNeeds, rosterReviewDecision, type Need } from '../formulas/needs';
import { needsInputsFor } from '../inputs';
import type { AiJobContext } from './context';
import { registerAiJob } from './registry';

export const ROSTER_REVIEW_JOB_ID = 'aip.rosterReview';
/** The review's summary key: params `count` and, when there is a need, `top`. */
export const ROSTER_REVIEW_SUMMARY_KEY = 'aip.decision.roster-review';

/**
 * The review's summary: how many needs, and the most pressing one in plain words (`top`, left out
 * when there are none).
 */
export function rosterReviewSummary(needs: readonly Need[]): TemplatedText {
  const [top] = needs;
  return {
    key: parseContentKey(ROSTER_REVIEW_SUMMARY_KEY),
    params:
      top === undefined ? { count: 0 } : { count: needs.length, top: needSummaryText(top.summary) },
  };
}

/**
 * "Weekly roster review: 3 needs, most pressing: Short on heels", or "Weekly roster review: no
 * pressing needs". The web text catalog (AIP1-06) renders the same key.
 */
export function rosterReviewSummaryText(summary: TemplatedText): string {
  const count = Number(summary.params['count'] ?? 0);
  const top = summary.params['top'];
  if (count <= 0 || top === undefined) {
    return 'Weekly roster review: no pressing needs';
  }
  return `Weekly roster review: ${String(count)} ${count === 1 ? 'need' : 'needs'}, most pressing: ${String(top)}`;
}

/** The first `AI_DECISION_MAX_REFS` distinct IDs, in the order the needs name them. */
function cappedRefs<Id extends string>(lists: readonly (readonly Id[])[]): Id[] {
  const seen = new Set<Id>();
  for (const list of lists) {
    for (const id of list) {
      if (seen.size >= AI_DECISION_MAX_REFS) {
        return [...seen];
      }
      seen.add(id);
    }
  }
  return [...seen];
}

/** Runs the review for one unit: needs, then one decision. */
export function runRosterReview(job: AiJobContext): void {
  const needs = rosterNeeds(needsInputsFor(job.read, job.tunables, job.unit, job.date), {
    tunables: job.tunables,
  });
  job.recordDecision({
    kind: ROSTER_REVIEW_DECISION_KIND,
    summary: rosterReviewSummary(needs),
    refs: {
      personIds: cappedRefs<PersonId>(needs.map((need) => need.refs.personIds)),
      titleIds: cappedRefs<TitleId>(needs.map((need) => need.refs.titleIds)),
    },
    traced: rosterReviewDecision(needs),
    revealOn: job.date,
    importance: 0,
  });
}

registerAiJob({ id: ROSTER_REVIEW_JOB_ID, cadence: 'weekly', run: runRosterReview });
