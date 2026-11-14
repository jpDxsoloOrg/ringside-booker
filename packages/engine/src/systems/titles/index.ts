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
import { TITLES_QUERIES } from './queries';
import { titlesCommands } from './commands';
import { titlesPhases } from './phases';

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
  addDefence,
  closeReign,
  openReign,
  type CloseReignInput,
  type OpenReignInput,
  type ReignWriteContext,
} from './reigns';

// CRTV1-02: the titles queries.
export {
  TITLES_QUERIES,
  titlesDetailQuery,
  titlesEligibleHoldersQuery,
  titlesListQuery,
} from './queries';
export {
  buildTitleCardRow,
  divisionLabel,
  endReasonLabel,
  PRESTIGE_NOT_KEPT_NOTE,
  PRESTIGE_TODAY_LABEL,
  PRESTIGE_WORLD_FILE_LABEL,
  prestigeExplanation,
  viewerEditsTitlesOf,
  type TitleCardChampion,
  type TitleCardHolder,
  type TitleCardRow,
  type TitleRowContext,
} from './rows';
export {
  PROMOTION_WIDE_GROUP_NAME,
  TITLE_LIST_SCOPES,
  TITLE_LIST_STATUSES,
  titleListOf,
  type TitleGroup,
  type TitleListArgs,
  type TitleListResult,
  type TitleListScope,
  type TitleListStatus,
} from './list';
export {
  TITLE_NOT_FOUND,
  TITLE_NOT_FOUND_MESSAGE,
  titleDetailOf,
  type ReignHolderRow,
  type ReignRow,
  type TitleDetail,
  type TitleStats,
} from './lineage';
export {
  daysVacant,
  titleRecords,
  type TitleRecord,
  type TitleRecordPerson,
  type TitleRecordReign,
  type TitleRecords,
} from './records';
export {
  eligibleHoldersOf,
  type EligibleHolders,
  type EligiblePerson,
  type EligibleTeam,
  type IneligiblePerson,
} from './eligibleHolders';

// CRTV1-03: commands, doors and the orphaned-champion phase.
export {
  awardTitleCommand,
  createTitleCommand,
  editTitleCommand,
  reactivateTitleCommand,
  retireTitleCommand,
  titlesCommands,
  vacateTitleCommand,
  type TitleAwardArgs,
  type TitleCreateArgs,
  type TitleEditArgs,
} from './commands';
export {
  BOOKER_VACANCY_REASON_KEY,
  bookerVacancyExplanation,
  ORPHANED_VACANCY_REASON_KEY,
  reactivateTitle,
  retireTitle,
  titleSourceOf,
  vacateTitle,
  type TitleDoorContext,
  type TitleStatusInput,
  type VacateTitleInput,
} from './doors';
export {
  holderStandings,
  isOrphaned,
  ORPHANED_CHAMPIONS_DOC_REF,
  orphanVacancyExplanation,
  runVacateOrphaned,
  titlesPhases,
  VACATE_ORPHANED_PHASE_ID,
  vacateOrphanedPhase,
  type HolderStanding,
} from './phases';
export { TITLE_VACANCY_TRACE_KIND, titleVacancyTraceRef } from './traces';
export {
  TITLE_COMMAND_REASON_CODES,
  TITLE_NAME_MAX_LENGTH,
  type TitleCommandReasonCode,
} from './validate';

export const titlesSystem: SystemBundle = defineSystem({
  id: 'titles',
  queries: TITLES_QUERIES,
  phases: titlesPhases,
  commands: titlesCommands,
});
