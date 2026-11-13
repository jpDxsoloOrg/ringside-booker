import { createContext } from 'react';
import type { RosterRow } from '@ringside/engine';
import type { DropdownMenuAction } from '@/components/DropdownMenu';

/** What the screen hands the row menu: its state, and the sheets the menu's items open. */
export interface RosterRowActionContext {
  /**
   * True while days are advancing: the engine refuses every command until the day is done, so
   * the items are disabled and say why.
   */
  readonly advancing: boolean;
  /** Opens the Set push sheet for one wrestler. */
  readonly openSetPush: (row: RosterRow) => void;
}

/**
 * One item of a roster row's menu, or null when it does not apply to the row (a referee has no
 * push). Later features (turns, brand moves, releases) append theirs to `rosterRowActions` in
 * `rosterColumns.tsx`, and add what they open to the context.
 */
export type RosterRowAction = (
  row: RosterRow,
  context: RosterRowActionContext,
) => DropdownMenuAction | null;

/** The row menu's context, provided by the roster screen. No menu renders without it. */
export const RosterRowActionsContext = createContext<RosterRowActionContext | null>(null);

/** Why an action is disabled while days are advancing, in words beside it. */
export const WAIT_FOR_DAY_TEXT = 'Wait for the day to finish';
