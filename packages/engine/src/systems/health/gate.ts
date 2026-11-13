/**
 * The own-injury gate (WRK6-04): when one of the player's workers gets hurt, the day stops with
 * "<name> was injured" so they never find out weeks later. Each injury waits to be noticed
 * (`noticedOn` null, decided by `needsNotice` when it is written), and the screens that show it run
 * `health.acknowledgeInjuries` to let the day move again.
 *
 * Like every gate it only reads: one lookup on the `awaitingNotice` index. Design:
 * docs/design/health.md#own-injury-gate.
 */

import { dayOfMonth, month, year, type GameDate } from '../../core/date';
import type { PersonId } from '../../core/ids';
import type { GateHit, GateSpec } from '../../core/pipeline/gates';
import { injuryKindOf } from '../../model/catalogs';
import type { InjuryRecord } from '../../model/entities/injury';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { primaryEmploymentOf } from '../workers/helpers/employment';

export const OWN_WORKER_INJURED_GATE_ID = 'health.ownWorkerInjured';

/** The web shell's route key for the roster ("Go to the roster"). */
export const ROSTER_ACTION_HINT = 'roster';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** "14 March 2031". */
export function plainDate(date: GameDate): string {
  return `${String(dayOfMonth(date))} ${MONTHS[month(date) - 1] ?? ''} ${String(year(date))}`;
}

/** The name the worker is known by on `date`: their main employer's ring name, else their own. */
export function ringNameOn(read: GameWorldView, personId: PersonId, date: GameDate): string {
  const person = read.tables.people.get(personId);
  if (person === undefined) {
    return 'A worker';
  }
  return primaryEmploymentOf(read, person.id, date)?.ringName ?? person.defaultRingName;
}

/** The injuries waiting to be noticed, lowest id first. */
export function injuriesAwaitingNotice(read: GameWorldView): readonly DeepReadonly<InjuryRecord>[] {
  return read.tables.injuries.lookup('awaitingNotice', 'pending');
}

/** "Big Joe was injured (Sprained ankle, out until 14 March 2031)", or "... and 2 others were injured". */
export function ownInjuryReason(
  read: GameWorldView,
  waiting: readonly DeepReadonly<InjuryRecord>[],
  date: GameDate,
): string | null {
  const [first] = waiting;
  if (first === undefined) {
    return null;
  }
  const name = ringNameOn(read, first.personId, date);
  if (waiting.length > 1) {
    const others = waiting.length - 1;
    return `${name} and ${String(others)} ${others === 1 ? 'other' : 'others'} were injured`;
  }
  const label = injuryKindOf(read, first.kindKey)?.label ?? 'an injury';
  return `${name} was injured (${label}, out until ${plainDate(first.expectedReturn)})`;
}

/** Stops the day while any of the player's workers' injuries waits to be noticed. */
export const ownWorkerInjuredGate: GateSpec = {
  id: OWN_WORKER_INJURED_GATE_ID,
  label: 'Your worker was injured',
  check: (view, date): GateHit | null => {
    const waiting = injuriesAwaitingNotice(view);
    const reason = ownInjuryReason(view, waiting, date);
    const [first] = waiting;
    if (reason === null || first === undefined) {
      return null;
    }
    return {
      gateId: OWN_WORKER_INJURED_GATE_ID,
      reason,
      subject: { kind: 'person', id: first.personId },
      actionHint: ROSTER_ACTION_HINT,
    };
  },
};
