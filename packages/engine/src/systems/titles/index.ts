/**
 * The titles system (CRTV1): who holds each belt, who may, and the only code that opens and closes
 * reigns. Layout copied from the health system (`systems/health/`): `tunables.ts`, `events.ts`,
 * `helpers/`, `formulas/`. CRTV1-02 adds the queries, CRTV1-03 the commands and the daily
 * orphaned-champion phase.
 *
 * Design: docs/design/titles.md.
 */

// The event declarations are types only. Importing them here brings them into every program that
// imports this system, including programs that only see the emitted .d.ts files.
import './events';
import { defineSystem, type SystemBundle } from '../../core/api/system';

export { TITLE_TIER_LABELS, TITLE_TIERS, TitleTierSchema, type TitleTier } from './tiers';
export { TITLES_TUNABLE_CATEGORY, titlesTunables } from './tunables';
export {
  STARTING_PRESTIGE_DOC_REF,
  startingPrestige,
  type StartingPrestigeDeps,
  type StartingPrestigeInputs,
} from './formulas/startingPrestige';
export {
  REIGN_DAYS_DOC_REF,
  REIGN_DAYS_NOTE,
  reignDateText,
  reignDays,
  type ReignDaysInputs,
} from './formulas/reignDays';
export { currentHolders, currentReign, reignLabel, titlesHeldBy } from './helpers/holders';
export {
  HOLDER_ELIGIBILITY_CODES,
  isEligibleHolder,
  type HolderEligibilityCode,
  type Holding,
} from './helpers/eligibility';
export {
  employedForTitle,
  employmentForTitle,
  lastEmployedForTitleOn,
  ringNameForTitle,
  titlePromotionIds,
} from './helpers/employment';
export { founderTitlePrestige, TITLE_PRESTIGE_TRACE_KIND, titlePrestigeTraceRef } from './traces';
export {
  closeReign,
  openReign,
  type CloseReignInput,
  type OpenReignInput,
  type ReignWriteContext,
} from './reigns';

export const titlesSystem: SystemBundle = defineSystem({ id: 'titles' });
