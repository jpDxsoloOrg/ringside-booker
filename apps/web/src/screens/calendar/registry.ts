import type { ReactNode } from 'react';
import type { CalendarScope, CalendarShow, GameDate } from '@ringside/engine';
import { createExtensionRegistry, sortedByOrder } from '@/components/extensionRegistry';
import type { RoleTone } from '@/components/tone';

/**
 * The calendar's extension slots. Another feature fills one from its own files by registering a
 * definition here; nothing in the calendar screen is edited. Each `register…` returns a function
 * that removes the definition again and throws when the id is already taken, and every open
 * calendar re-renders when a list changes.
 *
 * See README.md in this folder for what each slot is for and which feature is expected to use it.
 */

// The chip badge slot belongs to the chip, which is drawn outside the calendar too.
export { registerShowChipBadge, registeredShowChipBadges } from '@/components/ShowChip';
export type { ShowChipBadgeContext, ShowChipBadgeDefinition } from '@/components/ShowChip';

/** What the show sheet's actions and sections are drawn from. */
export interface ShowSheetContext {
  /** The show the sheet is open on. A projected show has no `eventInstanceId`. */
  readonly show: CalendarShow;
  /** True when the local seat runs the show. */
  readonly isOwn: boolean;
  /** The game's current date. */
  readonly today: GameDate;
}

/** One action in the show sheet's footer row, such as "Book this show". */
export interface ShowSheetActionDefinition {
  /** Unique, such as `booking.open`. */
  readonly id: string;
  /** Its place in the row, lowest first. The built-in Cancel show always comes last. */
  readonly order: number;
  /** Draws the action (a `Button` or a link), or returns null to leave it out for this show. */
  readonly render: (context: ShowSheetContext) => ReactNode;
}

/** One titled section under the show sheet's facts, such as the airing line. */
export interface ShowSheetSectionDefinition {
  /** Unique, such as `tv.airing`. */
  readonly id: string;
  /** Its place among the sections, lowest first. */
  readonly order: number;
  /** The section's heading. */
  readonly title: string;
  /** Draws the section's body, or returns null to leave the whole section out for this show. */
  readonly render: (context: ShowSheetContext) => ReactNode;
}

/** A day that matters without being a show: a draft day, the end of a season. */
export interface CalendarDayMarker {
  readonly date: GameDate;
  /** A word or two: "Draft day". */
  readonly label: string;
  readonly tone: RoleTone;
}

/** The days a marker source is asked about: the first and last day on screen, both included. */
export interface CalendarDayMarkerRange {
  readonly from: GameDate;
  readonly to: GameDate;
}

/** A source of day markers. */
export interface CalendarDayMarkersDefinition {
  /** Unique, such as `draft.days`. */
  readonly id: string;
  /**
   * A hook that returns the markers between `from` and `to`. It is called on every render of an
   * open calendar, so it may run its own engine queries; markers outside the range are ignored.
   */
  readonly useMarkers: (range: CalendarDayMarkerRange) => readonly CalendarDayMarker[];
}

/** What a toolbar item is drawn from. */
export interface CalendarToolbarContext {
  /** The first day of the month on screen. */
  readonly month: GameDate;
  /** Whose shows the calendar is listing. */
  readonly scope: CalendarScope;
  /** The game's current date. */
  readonly today: GameDate;
}

/** One control at the end of the calendar's toolbar, such as "New show". */
export interface CalendarToolbarItemDefinition {
  /** Unique, such as `shows.new`. */
  readonly id: string;
  /** Its place among the items, lowest first. */
  readonly order: number;
  /** Draws the control, or returns null to hide it. */
  readonly render: (context: CalendarToolbarContext) => ReactNode;
}

const sheetActions = createExtensionRegistry<ShowSheetActionDefinition>('A show sheet action');
const sheetSections = createExtensionRegistry<ShowSheetSectionDefinition>('A show sheet section');
const dayMarkers = createExtensionRegistry<CalendarDayMarkersDefinition>(
  'A calendar day marker source',
);
const toolbarItems =
  createExtensionRegistry<CalendarToolbarItemDefinition>('A calendar toolbar item');

/** Adds an action to the footer row of every show sheet. */
export function registerShowSheetAction(definition: ShowSheetActionDefinition): () => void {
  return sheetActions.register(definition);
}

/** Adds a titled section under the facts of every show sheet. */
export function registerShowSheetSection(definition: ShowSheetSectionDefinition): () => void {
  return sheetSections.register(definition);
}

/** Adds a source of markers for days that are not shows. */
export function registerCalendarDayMarkers(definition: CalendarDayMarkersDefinition): () => void {
  return dayMarkers.register(definition);
}

/** Adds a control to the end of the calendar's toolbar. */
export function registerCalendarToolbarItem(definition: CalendarToolbarItemDefinition): () => void {
  return toolbarItems.register(definition);
}

/** The registered sheet actions in display order, kept current. */
export function useShowSheetActions(): readonly ShowSheetActionDefinition[] {
  return sortedByOrder(sheetActions.useDefinitions());
}

/** The registered sheet sections in display order, kept current. */
export function useShowSheetSections(): readonly ShowSheetSectionDefinition[] {
  return sortedByOrder(sheetSections.useDefinitions());
}

/** The registered marker sources in registration order, kept current. */
export function useCalendarDayMarkerSources(): readonly CalendarDayMarkersDefinition[] {
  return dayMarkers.useDefinitions();
}

/** The registered toolbar items in display order, kept current. */
export function useCalendarToolbarItems(): readonly CalendarToolbarItemDefinition[] {
  return sortedByOrder(toolbarItems.useDefinitions());
}
