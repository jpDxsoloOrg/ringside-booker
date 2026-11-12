/**
 * Promotion popularity after shows (EVT5): how one completed show changes a promotion's popularity
 * in each region it reached.
 *
 * Formulas only for now: show reach, what each region's fans expected and the change itself. The
 * system bundle that runs them after every show (EVT5-02) builds on these. Design:
 * docs/design/promotion-popularity.md.
 */

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
