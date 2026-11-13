import { PUSH_LABELS } from '@ringside/engine';
import type { Push, RosterRoleGroup } from '@ringside/engine';

/**
 * The roster's words. Availability reuses `AVAILABILITY_LABELS` and `AVAILABILITY_TONES` from
 * `AvailabilityChip`, and card positions reuse the engine's `PUSH_LABELS` (the profile shows the
 * same words), so a person reads the same everywhere.
 */

/** What a cell shows where there is nothing to show. */
export const NO_VALUE = '—';

/** A card position in words; crew and managers (`none`) have none, so a dash. */
export function pushLabel(push: Push): string {
  return push === 'none' ? NO_VALUE : PUSH_LABELS[push];
}

export interface RoleGroupLabel {
  /** The tab: "Wrestlers". */
  readonly tab: string;
  /** The lower-case plural in a sentence: "No announcers under contract." */
  readonly plural: string;
}

/** Each roster section's words. A `Record`, so a new group fails to compile until it has them. */
export const ROLE_GROUP_LABELS: Readonly<Record<RosterRoleGroup, RoleGroupLabel>> = {
  wrestlers: { tab: 'Wrestlers', plural: 'wrestlers' },
  managers: { tab: 'Managers', plural: 'managers' },
  announcers: { tab: 'Announcers', plural: 'announcers' },
  referees: { tab: 'Referees', plural: 'referees' },
  producers: { tab: 'Producers', plural: 'producers' },
  others: { tab: 'Others', plural: 'other staff' },
};

/** The tab label of a roster section. */
export function roleGroupLabel(group: RosterRoleGroup): string {
  return ROLE_GROUP_LABELS[group].tab;
}

/** An empty section: "No announcers under contract." */
export function emptyGroupText(group: RosterRoleGroup): string {
  return `No ${ROLE_GROUP_LABELS[group].plural} under contract.`;
}
