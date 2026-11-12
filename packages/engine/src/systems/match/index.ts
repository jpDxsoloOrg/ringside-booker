/**
 * The match system: everything about a single segment on a card.
 *
 * So far: the slot derivations of D-10 (`slots.ts`: role, duration class and weight from a slot's
 * position, never stored), the match tunables (`tunables.ts`) and two queries (`queries.ts`):
 * `match.catalog` and `match.slotRoles`. The runtime catalogs it reads live in
 * `model/catalogs.ts`. No phase yet. Design: docs/design/match-rating.md.
 */

// The stream declarations are types only; importing them keeps them in every program that imports
// this system.
import './streams';
import { defineSystem, type SystemBundle } from '../../core/api/system';
import { matchQueries } from './queries';

export {
  DURATION_CLASSES,
  DURATION_CLASS_LABELS,
  SLOT_ROLES,
  SLOT_ROLE_LABELS,
  SLOTS_DOC_REF,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
  type DurationClass,
  type DurationClassInputs,
  type SlotDeps,
  type SlotPosition,
  type SlotRole,
  type SlotWeightInputs,
} from './slots';
export {
  SLOT_ROLES_MAX_PRE_SHOW_SLOTS,
  SLOT_ROLES_MAX_SLOTS,
  SLOT_ROLES_MIN_SLOTS,
  type AngleTypeOption,
  type CountRange,
  type MatchCatalog,
  type MatchTypeOption,
  type MethodOption,
  type SlotRoleRow,
  type SlotRolesArgs,
} from './queries';
export { matchTunables } from './tunables';

export const matchSystem: SystemBundle = defineSystem({
  id: 'match',
  queries: matchQueries,
});
