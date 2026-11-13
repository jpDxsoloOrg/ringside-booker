/**
 * Promotion popularity after shows (EVT5): how one completed show changes a promotion's popularity
 * in each region it reached.
 *
 * EVT5-01 adds the formulas: show reach, what each region's fans expected and the change itself.
 * EVT5-02 adds the system bundle that runs them after every completed show (`promoPop.applyAfterShow`
 * on `show.completed`), the per-show record and its monthly prune, the Why? traces, the
 * `showPopularity.changed` event and the `popularity.showChange` query. Design:
 * docs/design/promotion-popularity.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import { defineSubscription, defineSystem, type SystemBundle } from '../../core/api/system';
import { applyShowPopularity } from './apply';
import { promoPopPhases } from './phases';
import { promoPopQueries } from './queries';

export { importanceLabel, reachLabel, type ReachRoute, type ReachSource } from './formulas/labels';
export {
  REGION_EXPECTATION_DOC_REF,
  regionExpectation,
  type RegionExpectationInputs,
} from './formulas/regionExpectation';
export {
  MONTHLY_CAP_DOC_REF,
  SHOW_POPULARITY_CHANGE_DOC_REF,
  showPopularityChange,
  type ShowPopularityChangeInputs,
} from './formulas/showPopularityChange';
export {
  SHOW_REACH_DOC_REF,
  showReach,
  type ReachDealInput,
  type ReachedRegion,
  type ReachRegionInput,
  type ShowReach,
  type ShowReachInputs,
} from './formulas/showReach';

export {
  SHOW_RESULT_REASON_KEY,
  applyShowPopularity,
  gainsForMonth,
  type ApplyShowPopularityResult,
} from './apply';
export {
  monthlyGainsOf,
  popularityBeforeShow,
  recentShowChanges,
  showChangeOf,
  type RecentShowChange,
} from './helpers';
export {
  keepShowChangesFrom,
  lastPruneCutoff,
  promoPopPhases,
  pruneShowChangesPhase,
} from './phases';
export {
  SHOW_CHANGE_NOT_FOUND_MESSAGE,
  SHOW_CHANGE_STATUSES,
  promoPopQueries,
  showChangeQuery,
  type ShowChangeCountryView,
  type ShowChangeRegionView,
  type ShowChangeStatus,
  type ShowChangeSummaryView,
  type ShowPopularityChangeView,
} from './queries';
export { dealsInForce, reachInputsFor, type ReachShow } from './reach';
export {
  PROMO_POP_TRACE_KINDS,
  RIVAL_SHOW_CHANGE_TRACE_KIND,
  SHOW_CHANGE_TRACE_KIND,
  showChangeTraceRef,
} from './traces';
export { promoPopTunables } from './tunables';

/** The subscription id of the reaction that applies a completed show's popularity change. */
export const APPLY_AFTER_SHOW_SUBSCRIPTION_ID = 'promoPop.applyAfterShow';

export const promoPopSystem: SystemBundle = defineSystem({
  id: 'promoPop',
  subscriptions: [
    defineSubscription({
      id: APPLY_AFTER_SHOW_SUBSCRIPTION_ID,
      type: 'show.completed',
      handler: (event, ctx) => {
        applyShowPopularity(ctx, event.payload.eventInstanceId);
      },
    }),
  ],
  phases: promoPopPhases,
  queries: promoPopQueries,
});
