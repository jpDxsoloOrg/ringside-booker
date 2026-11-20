/**
 * The schedule editor's balance numbers: how soon and how far ahead a new or changed show may
 * land, and the card size each importance starts with.
 *
 * A show's size is its slot count and pre-show slot count, never minutes (design decision D-10).
 * The defaults per importance are the WLD-08 suggestions (data-model.md#show-format-and-the-slot-model).
 *
 * Design notes: docs/design/calendar.md#schedule-editor.
 */

import { defineTunables } from '../../../core/tunables/define';
import {
  PRE_SHOW_SLOTS_MAX,
  PRE_SHOW_SLOTS_MIN,
  SHOW_SLOTS_MAX,
  SHOW_SLOTS_MIN,
  type EventImportance,
  type ShowFormat,
} from '../../../model/entities/event-definition';
import type { EngineTunables } from '../../tunables';

const SCHEDULE_CATEGORY = 'Schedule';
const EDITOR_DOC = 'calendar.md#schedule-editor';

function slots(defaultValue: number, importance: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: SHOW_SLOTS_MIN,
    max: SHOW_SLOTS_MAX,
    unit: 'count',
    category: SCHEDULE_CATEGORY,
    description: `Main-card slots a new ${importance} show starts with in the schedule editor`,
    docRef: EDITOR_DOC,
  } as const;
}

function preShowSlots(defaultValue: number, importance: string) {
  return {
    kind: 'integer',
    default: defaultValue,
    min: PRE_SHOW_SLOTS_MIN,
    max: PRE_SHOW_SLOTS_MAX,
    unit: 'count',
    category: SCHEDULE_CATEGORY,
    description: `Pre-show slots a new ${importance} show starts with in the schedule editor`,
    docRef: EDITOR_DOC,
  } as const;
}

export const calendarEditorTunables = defineTunables({
  'calendar.editor.minLeadDays': {
    kind: 'integer',
    default: 1,
    min: 0,
    max: 60,
    unit: 'days',
    category: SCHEDULE_CATEGORY,
    description:
      'The first day a new or changed show can land on is today plus this; 0 means changes apply from today',
    docRef: EDITOR_DOC,
  },
  'calendar.editor.maxLeadDays': {
    kind: 'integer',
    default: 730,
    min: 30,
    max: 3650,
    unit: 'days',
    category: SCHEDULE_CATEGORY,
    description: "The latest day a one-off special or a new show's first date may use, from today",
    docRef: EDITOR_DOC,
  },
  'calendar.format.house.slots': slots(5, 'house'),
  'calendar.format.minor.slots': slots(5, 'minor'),
  'calendar.format.regular.slots': slots(6, 'regular'),
  'calendar.format.major.slots': slots(8, 'major'),
  'calendar.format.flagship.slots': slots(10, 'flagship'),
  'calendar.format.house.preShowSlots': preShowSlots(0, 'house'),
  'calendar.format.minor.preShowSlots': preShowSlots(0, 'minor'),
  'calendar.format.regular.preShowSlots': preShowSlots(0, 'regular'),
  'calendar.format.major.preShowSlots': preShowSlots(1, 'major'),
  'calendar.format.flagship.preShowSlots': preShowSlots(2, 'flagship'),
});

/** The card size a new show of `importance` starts with in the editor. */
export function defaultFormatFor(
  tunables: EngineTunables,
  importance: EventImportance,
): ShowFormat {
  switch (importance) {
    case 'house':
      return {
        slots: tunables.get('calendar.format.house.slots'),
        preShowSlots: tunables.get('calendar.format.house.preShowSlots'),
      };
    case 'minor':
      return {
        slots: tunables.get('calendar.format.minor.slots'),
        preShowSlots: tunables.get('calendar.format.minor.preShowSlots'),
      };
    case 'regular':
      return {
        slots: tunables.get('calendar.format.regular.slots'),
        preShowSlots: tunables.get('calendar.format.regular.preShowSlots'),
      };
    case 'major':
      return {
        slots: tunables.get('calendar.format.major.slots'),
        preShowSlots: tunables.get('calendar.format.major.preShowSlots'),
      };
    case 'flagship':
      return {
        slots: tunables.get('calendar.format.flagship.slots'),
        preShowSlots: tunables.get('calendar.format.flagship.preShowSlots'),
      };
  }
}
