/**
 * The office system: the promotion history behind the Office (DAY2).
 *
 * DAY2-01 adds the history itself: the `promotionSnapshots` table, a weekly Monday row for every
 * open promotion (`phases.ts`), a baseline row at new game (`setup.ts`), the thinning of old weeks
 * to one row per month (`history/compaction.ts`) and the registry other features use to add a
 * number to every row (`history/snapshotFields.ts`). The player sees nothing new until DAY2-03 and
 * DAY2-04 turn the rows into deltas and sparklines.
 *
 * DAY2-02 adds the headline popularity: one roll-up level picked by
 * `office.popularity.headlineScope` (`popularity.ts`), its stored Why? that `sim.status` reads
 * (`traces.ts`), kept current by the setup step, the weekly phase and the two subscriptions below,
 * the trace sections seam (`popularityTraceSections.ts`) and the `office.fanBase` query.
 * See docs/design/office.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './setup';
import { defineSubscription, defineSystem, type SystemBundle } from '../../core/api/system';
import { isId } from '../../core/ids';
import { officePhases } from './phases';
import { recordAllHeadlinePopularity, recordHeadlinePopularity } from './popularity';
import { officeQueries } from './queries';

export { officeTunables, HEADLINE_SCOPES, type HeadlineScope } from './tunables';
export {
  formatPopularity,
  HEADLINE_POPULARITY_DOC_REF,
  HEADLINE_TRAIL_NODES,
  headlinePopularity,
  type HeadlinePlace,
  type HeadlinePopularityInputs,
} from './formulas/headlinePopularity';
export {
  createOfficeRoller,
  headlinePopularityOf,
  headlinePopularityValue,
  recordAllHeadlinePopularity,
  recordHeadlinePopularity,
  type OfficeRoller,
} from './popularity';
export {
  popularityTraceSectionLines,
  popularityTraceSections,
  registerPopularityTraceSection,
  type PopularityTraceSectionSpec,
} from './popularityTraceSections';
export { fanBaseQuery, NO_PROMOTION, officeQueries, type FanBaseView } from './queries';
export { POPULARITY_TRACE_KIND, popularityTraceRef } from './traces';
export {
  buildPromotionSnapshot,
  createSnapshotRoller,
  type PromotionSnapshotColumns,
  type SnapshotRoller,
} from './history/buildSnapshot';
export { planCompaction, type CompactionPlan, type CompactionRow } from './history/compaction';
export {
  BUILT_IN_SNAPSHOT_COLUMNS,
  extractSnapshotFields,
  promotionSnapshotFields,
  registerPromotionSnapshotField,
  type PromotionSnapshotFieldSpec,
  type SnapshotFieldKpi,
  type SnapshotFieldUnit,
  type SnapshotFieldVisibility,
} from './history/snapshotFields';
export {
  compactPromotionSnapshots,
  fullDetailCutoff,
  writePromotionSnapshots,
} from './history/writeSnapshots';
export {
  WEEKLY_SNAPSHOT_PHASE_ID,
  WEEKLY_SNAPSHOT_PHASE_ORDER,
  weeklySnapshotPhase,
} from './phases';
export { OFFICE_BASELINE_SNAPSHOT_STEP } from './setup';

/** The subscription that re-records a promotion's popularity Why? when its popularity changes. */
export const POPULARITY_CHANGED_SUBSCRIPTION_ID = 'office.popularityChanged';
/** The subscription that re-records every popularity Why? when the headline scope changes. */
export const HEADLINE_SCOPE_CHANGED_SUBSCRIPTION_ID = 'office.headlineScopeChanged';

export const officeSystem: SystemBundle = defineSystem({
  id: 'office',
  phases: [...officePhases],
  subscriptions: [
    defineSubscription({
      id: POPULARITY_CHANGED_SUBSCRIPTION_ID,
      type: 'popularity.changed',
      handler: (event, ctx) => {
        const { subjectKind, subjectId } = event.payload;
        if (subjectKind === 'promotion' && isId('promotion', subjectId)) {
          recordHeadlinePopularity(ctx, subjectId);
        }
      },
    }),
    defineSubscription({
      id: HEADLINE_SCOPE_CHANGED_SUBSCRIPTION_ID,
      type: 'tunables.changed',
      handler: (event, ctx) => {
        if (event.payload.key === 'office.popularity.headlineScope') {
          recordAllHeadlinePopularity(ctx);
        }
      },
    }),
  ],
  queries: officeQueries,
});
