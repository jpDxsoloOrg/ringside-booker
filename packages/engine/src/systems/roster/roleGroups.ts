/**
 * How the roster groups its rows, and the order card positions are read in.
 *
 * Design: docs/design/roster.md#roster-rows.
 */

import { PUSH_LEVELS, type EmploymentRole, type Push } from '../../model/entities/employment';

/** The roster's sections, in the order the screen shows them. */
export const ROSTER_ROLE_GROUPS = [
  'wrestlers',
  'managers',
  'announcers',
  'referees',
  'producers',
  'others',
] as const;
export type RosterRoleGroup = (typeof ROSTER_ROLE_GROUPS)[number];

/**
 * The section a contract's role belongs in. The switch has no default, so a new employment role
 * fails to compile until it is given a group.
 */
export function rosterRoleGroupOf(role: EmploymentRole): RosterRoleGroup {
  switch (role) {
    case 'wrestler':
      return 'wrestlers';
    case 'manager':
      return 'managers';
    case 'announcer':
      return 'announcers';
    case 'referee':
      return 'referees';
    case 'producer':
      return 'producers';
    case 'presenter':
    case 'booker':
      return 'others';
  }
}

/** A card position as a number: its place in `PUSH_LEVELS` (main event 0 … enhancement 4, none 5). */
export function pushIndexOf(push: Push): number {
  return PUSH_LEVELS.indexOf(push);
}

/** Why card positions are fixed numbers in a trace and not tunables. */
export const PUSH_ORDER_REASON = 'Order of the card positions, main event first';

/**
 * True for a role that has a card position. Only wrestlers do; `none` is the push of crew and
 * managers.
 */
export function roleHasPush(role: EmploymentRole): boolean {
  return role === 'wrestler';
}
