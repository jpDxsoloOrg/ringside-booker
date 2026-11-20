/**
 * The schedule editor: the player's own recurring shows (create, change, retire, with a safe
 * re-sync of the future dates) and one-off specials. A separate bundle from `calendar` so the
 * calendar's own files only gain the `instanceFieldsFor` extraction.
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import './events';
import { defineSystem, type SystemBundle } from '../../../core/api/system';
import { calendarEditorCommands } from './commands';
import { calendarEditorQueries } from './queries';

export {
  addOneOffIn,
  applyResync,
  createDefinitionIn,
  retireDefinitionIn,
  updateDefinitionIn,
  type EditorContext,
  type OneOffInput,
  type ResyncOutcome,
} from './apply';
export {
  addOneOffCommand,
  calendarEditorCommands,
  createDefinitionCommand,
  retireDefinitionCommand,
  updateDefinitionCommand,
  type AddOneOffArgs,
  type KeptShowView,
  type ResyncResultView,
} from './commands';
export { controlsSchedule } from './control';
export { checkDraft, DefinitionDraftSchema, type DefinitionDraft } from './definitionDraft';
export { checkNewShow, type NewShowWarning } from './newShowChecks';
export {
  calendarEditorQueries,
  type DefinitionRow,
  type EditorOptionsView,
  type PlaceChoicesView,
  type PlanView,
  type PreviewDefinitionView,
  type PreviewRetireView,
} from './queries';
export { planResync, type ResyncPlan } from './planResync';
export { instanceIsReferenced, referencedInstances } from './references';
export { calendarEditorTunables, defaultFormatFor } from './tunables';

export const calendarEditorSystem: SystemBundle = defineSystem({
  id: 'calendarEditor',
  queries: calendarEditorQueries,
  commands: calendarEditorCommands,
});
