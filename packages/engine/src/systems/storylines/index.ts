/**
 * Storylines (CRTV3): the feuds and angles that tie segments together across shows.
 *
 * CRTV3-01 lays the ground: the read queries the Storylines desk and other screens use
 * (`storylines.list`, `storylines.detail`, `storylines.forPerson`, `storylines.memberOptions`),
 * the engine-side reader other systems share (`storylineContextFor`, `storylinesOfPerson`,
 * `activeStorylinesOf`), the read-side tunables, the trace kinds and the domain events. CRTV3-02
 * adds starting heat (`startStoryline`), the daily `storylines.heatCooling` phase, the weekly
 * `storylines.pruneDetail` and the `storylines.seedStarters` new-game step. CRTV3-03 adds the
 * player's commands (create, edit, addMember, removeMember, setSide, end), `endStoryline` and
 * `storylines.endPreview`; CRTV4 heat after segments and the payoff.
 *
 * Design: docs/design/storylines.md.
 */

// The event and stream declarations are types only. Importing them here brings them into every
// program that imports this system, including programs that only see the emitted .d.ts files.
import './events';
import './streams';
// Registers the `storylines.seedStarters` new-game step (CRTV3-02).
import './setup';
// Registers the `storylines.links` booking check and the `storylines.clearFinaleOnRemove` segment
// hook (CRTV4-01).
import './card/bookingCheck';
import './card/finaleHook';
// Registers the `storylines.heat` segment result applier (CRTV4-02).
import './card/heatApplier';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { storylinesCardCommands } from './card/commands';
import { storylinesCardQueries } from './card/queries';
import { storylinesCommands } from './commands';
import { storylinesEndPreviewQuery } from './endPreview';
import { storylinesPhases } from './phases';
import { storylinesQueries } from './queries';

export {
  activeStorylinesOf,
  daysSinceProgress,
  linkedSegmentIdsOf,
  storylineContextFor,
  storylinesOfPerson,
  type StorylineContext,
} from './context';
export {
  addStorylineMemberCommand,
  createStorylineCommand,
  editStorylineCommand,
  endStorylineCommand,
  removeStorylineMemberCommand,
  setStorylineSideCommand,
  storylinesCommands,
  type StorylineCreateArgs,
  type StorylineEditArgs,
  type StorylineMemberArgs,
} from './commands';
export { storylinesEndPreviewQuery, type StorylineEndPreview } from './endPreview';
export { STORYLINE_START_SOURCES, type StorylineStartSource } from './events';
export {
  HEAT_AFTER_SEGMENT_DOC_REF,
  heatAfterSegment,
  type HeatAfterSegmentInputs,
} from './formulas/heatAfterSegment';
export { HEAT_DECAY_DOC_REF, heatDecay, type HeatDecayInputs } from './formulas/heatDecay';
export { HOT_STORYLINE_DOC_REF, isHotHeat } from './formulas/hot';
export {
  STARTING_HEAT_DOC_REF,
  STAR_POWER_MEMBERS,
  startingHeat,
  type StartingHeatInputs,
  type StartingHeatMember,
} from './formulas/startingHeat';
export {
  endOutcome,
  endOutcomeMessage,
  endStoryline,
  keepsFullStorylineTraces,
  startingHeatMembers,
  startStoryline,
  type StartStorylineSpec,
  type StorylineEndContext,
  type StorylineEndOutcome,
  type StorylineEndPayoff,
} from './lifecycle';
export {
  coolStorylines,
  HEAT_COOLING_PHASE_ID,
  HEAT_COOLING_PHASE_ORDER,
  heatCoolingPhase,
  PRUNE_STORYLINE_DETAIL_PHASE_ID,
  PRUNE_STORYLINE_DETAIL_PHASE_ORDER,
  pruneStorylineDetail,
  pruneStorylineDetailPhase,
  storylinesPhases,
} from './phases';
export {
  STARTER_DOC_REF,
  STARTER_PICK_FROM,
  STARTER_SUMMARY,
  STORYLINES_SEED_STARTERS_STEP,
  seedStarterStorylines,
  starterCandidates,
  type StarterCandidate,
} from './setup';
export { STARTERS_STREAM } from './streams';
export {
  STORYLINES_NO_PROMOTION_MESSAGE,
  STORYLINES_NOT_YOURS_MESSAGE,
  STORYLINES_PERSON_NOT_FOUND_MESSAGE,
  STORYLINES_PROMOTION_NOT_FOUND_MESSAGE,
  STORYLINE_LIST_STATUSES,
  STORYLINE_NOT_FOUND_MESSAGE,
  STORYLINE_PAYOFFS,
  STORYLINE_REASONS,
  storylinesDetailQuery,
  storylinesForPersonQuery,
  storylinesListQuery,
  storylinesMemberOptionsQuery,
  storylinesQueries,
  type StorylineDetail,
  type StorylineCoolingView,
  type StorylineEndingView,
  type StorylineListStatus,
  type StorylineListView,
  type StorylineMemberOption,
  type StorylineMemberOptionsView,
  type StorylinePayoff,
  type StorylinesForPersonView,
  type StorylineTimelineEntry,
} from './queries';
export {
  activeEmploymentAt as storylineEmploymentAt,
  buildStorylineRow,
  compareStorylineRows,
  editsStorylinesOf,
  seesStorylinesOf,
  type StorylineMemberView,
  type StorylineRow,
  type StorylineRowOptions,
} from './rows';
export {
  STORYLINE_HEAT_TRACE_KIND,
  STORYLINE_PAYOFF_TRACE_KIND,
  STORYLINE_STARTER_TRACE_KIND,
  STORYLINE_TRACE_KINDS,
  storylineHeatTraceRef,
  storylinePayoffTraceRef,
  storylineStarterTraceRef,
} from './traceKinds';
export { storylinesTunables } from './tunables';
export {
  brandReasons as storylineBrandReasons,
  checkOwnStoryline,
  memberReasons as storylineMemberReasons,
  nameReasons as storylineNameReasons,
  ownStorylineReasons,
  STORYLINE_COMMAND_REASONS,
  STORYLINE_NAME_MAX_LENGTH,
  STORYLINE_WARNINGS,
  type OwnStorylineCheck,
} from './validation';

// Linking segments to storylines (CRTV4-01). See docs/design/storylines.md#linking.
export {
  STORYLINE_LINK_WARNINGS,
  STORYLINE_LINKS_CHECK_ID,
  storylineLinksBookingCheck,
} from './card/bookingCheck';
export {
  linkSegmentCommand,
  setFinaleCommand,
  storylinesCardCommands,
  type StorylineLinkSegmentArgs,
  type StorylineSetFinaleArgs,
} from './card/commands';
export { CLEAR_FINALE_HOOK_ID, clearFinaleHook } from './card/finaleHook';
export {
  linkableStorylines,
  segmentWasPlayed,
  storylineFitsShow,
  storylinesWithFinale,
  STORYLINE_LINK_REASONS,
} from './card/links';
export { membersInSegment } from './card/membersInSegment';
export {
  storylinesCardQueries,
  storylinesLinkOptionsQuery,
  type StorylineFinaleElsewhere,
  type StorylineLinkedRow,
  type StorylineLinkOptions,
  type StorylineOtherRow,
  type StorylineSuggestionRow,
} from './card/queries';

export const storylinesSystem: SystemBundle = defineSystem({
  id: 'storylines',
  phases: storylinesPhases,
  queries: [...storylinesQueries, storylinesEndPreviewQuery, ...storylinesCardQueries],
  commands: [...storylinesCommands, ...storylinesCardCommands],
});
