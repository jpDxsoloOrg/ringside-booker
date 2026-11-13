/**
 * The office system: the promotion history behind the Office (DAY2).
 *
 * DAY2-01 adds the history itself: the `promotionSnapshots` table, a weekly Monday row for every
 * open promotion (`phases.ts`), a baseline row at new game (`setup.ts`), the thinning of old weeks
 * to one row per month (`history/compaction.ts`) and the registry other features use to add a
 * number to every row (`history/snapshotFields.ts`). The player sees nothing new until DAY2-03 and
 * DAY2-04 turn the rows into deltas and sparklines. See docs/design/office.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './setup';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { officePhases } from './phases';

export { officeTunables } from './tunables';
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

export const officeSystem: SystemBundle = defineSystem({
  id: 'office',
  phases: [...officePhases],
});
