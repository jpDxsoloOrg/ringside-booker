/**
 * A show's time budget and each segment's time (EVT4-08).
 *
 * D-10 still holds: nothing here is minutes. Each duration class costs a number of time units
 * (`match.time.units.<class>`: Short 1, Standard 2, Long 3), and a show has room for the time its
 * format takes when every slot keeps its role's usual class, plus extra room by importance
 * (`match.time.room.<importance>`): a weekly show has room for about one more long match, a flagship
 * show for several. The booker spends that room by setting a segment's time (`bookedLength`), and
 * gets it back by shortening another. A card with every slot at its usual time always fits, so the
 * defaults score exactly as before; the booking check only fails a card the booker lengthened.
 *
 * Design: docs/design/match-rating.md#show-time.
 */

import { startCalc, type Traced } from '../../core/trace';
import { matchTypeOf } from '../../model/catalogs';
import type { EventImportance } from '../../model/entities/event-definition';
import type { EventInstance } from '../../model/entities/event-instance';
import { settingOf, type Segment } from '../../model/entities/segment';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import type { EngineTunables, NumberTunableKey } from '../tunables';
import { settingDurationShifter } from './angles/settings';
import { EVENT_IMPORTANCE_LABELS } from './formulas/crowdExpectation';
import {
  DURATION_CLASS_LABELS,
  SLOT_ROLE_LABELS,
  bookedSteps,
  durationClassOf,
  slotRoleOf,
  type DurationClass,
  type DurationClassInputs,
  type SlotRole,
} from './slots';

export const SHOW_TIME_DOC_REF = 'match-rating.md#show-time';

const UNIT_KEYS = {
  short: 'match.time.units.short',
  standard: 'match.time.units.standard',
  long: 'match.time.units.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

const ROOM_KEYS = {
  house: 'match.time.room.house',
  minor: 'match.time.room.minor',
  regular: 'match.time.room.regular',
  major: 'match.time.room.major',
  flagship: 'match.time.room.flagship',
} as const satisfies Readonly<Record<EventImportance, NumberTunableKey>>;

/** How many time units a duration class takes. */
export function timeUnitsOf(durationClass: DurationClass, tunables: EngineTunables): number {
  return tunables.get(UNIT_KEYS[durationClass]);
}

/** A stored segment's role and duration class where it sits now. */
export interface SegmentDuration {
  readonly role: Traced<SlotRole>;
  /** The class it runs at: the booked time (if any), moved by its match type or setting. */
  readonly duration: Traced<DurationClass>;
  /** The class it would run at with the role's usual time (no booked time). */
  readonly usual: DurationClass;
  /** Steps the booked time moves it from `usual`: +1 for one step longer, −1 for one shorter. */
  readonly steps: number;
}

/** What moves a stored segment's class: its match type, or a talking segment's setting. */
export function durationShifterOf(
  read: GameWorldView,
  segment: DeepReadonly<Segment>,
  tunables: EngineTunables,
): DurationClassInputs['matchType'] {
  if (segment.kind === 'match') {
    return matchTypeOf(read, segment.match.matchTypeKey) ?? null;
  }
  return settingDurationShifter(settingOf(segment), tunables);
}

/**
 * A stored segment's role and class where it sits on `format`. Returns null for a main-card slot
 * past the format's last slot (a card being reshaped).
 */
export function segmentDurationOf(
  read: GameWorldView,
  segment: DeepReadonly<Segment>,
  format: DeepReadonly<EventInstance['format']>,
  tunables: EngineTunables,
): SegmentDuration | null {
  if (!segment.preShow && segment.slot >= format.slots) {
    return null;
  }
  const deps = { tunables };
  const role = slotRoleOf(
    { slot: segment.slot + 1, slots: format.slots, preShow: segment.preShow },
    deps,
  );
  const inputs: DurationClassInputs = {
    role: role.value,
    matchType: durationShifterOf(read, segment, tunables),
    booked: segment.bookedLength ?? null,
  };
  const duration = durationClassOf(inputs, deps);
  return { role, duration, ...bookedSteps(inputs, duration.value, tunables) };
}

/** The roles of every slot a format has, pre-show first. */
export function formatRoles(
  format: DeepReadonly<EventInstance['format']>,
  tunables: EngineTunables,
): SlotRole[] {
  const deps = { tunables };
  const roles: SlotRole[] = [];
  for (let slot = 1; slot <= format.preShowSlots; slot += 1) {
    roles.push(slotRoleOf({ slot, slots: format.slots, preShow: true }, deps).value);
  }
  for (let slot = 1; slot <= format.slots; slot += 1) {
    roles.push(slotRoleOf({ slot, slots: format.slots, preShow: false }, deps).value);
  }
  return roles;
}

export interface ShowTimeBudgetInputs {
  readonly importance: EventImportance;
  /** Every slot of the format, filled or not. */
  readonly roles: readonly SlotRole[];
}

/**
 * The show's time: every slot of its format at its role's usual class, plus the extra room its
 * importance gives. "Time the card usually takes 15" then "Regular show: room for +2".
 */
export function showTimeBudget(
  inputs: ShowTimeBudgetInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Show time', 0, {
    unit: 'count',
    docRef: SHOW_TIME_DOC_REF,
    startLabel: 'No time yet',
  });
  const usual = startCalc('Time the card usually takes', 0, {
    unit: 'count',
    startLabel: 'No slots',
  });
  for (const role of inputs.roles) {
    const durationClass = durationClassOf({ role, matchType: null }, { tunables }).value;
    usual.add(
      `${SLOT_ROLE_LABELS[role]}: ${DURATION_CLASS_LABELS[durationClass]}`,
      usual.tunable(tunables, UNIT_KEYS[durationClass], `${DURATION_CLASS_LABELS[durationClass]}`),
    );
  }
  calc.add('Time the card usually takes', usual.done());
  const label = EVENT_IMPORTANCE_LABELS[inputs.importance];
  const room = calc.tunable(tunables, ROOM_KEYS[inputs.importance], `${label} show's extra room`);
  calc.add(`${label} show: room for +${String(room)}`, room);
  return calc.done();
}

/** One filled slot as the time used counts it. */
export interface TimedSlot {
  /** "Slot 2" or "Pre-show 1". */
  readonly place: string;
  readonly durationClass: DurationClass;
}

/** The time the card's filled slots take: one line per slot, "Slot 2: Long +3". */
export function cardTimeUsed(
  slots: readonly TimedSlot[],
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc('Time used', 0, {
    unit: 'count',
    docRef: SHOW_TIME_DOC_REF,
    startLabel: 'Nothing booked yet',
  });
  for (const slot of slots) {
    const units = calc.tunable(
      tunables,
      UNIT_KEYS[slot.durationClass],
      DURATION_CLASS_LABELS[slot.durationClass],
    );
    calc.add(
      `${slot.place}: ${DURATION_CLASS_LABELS[slot.durationClass]} +${String(units)}`,
      units,
    );
  }
  return calc.done();
}

/** A show's time: what its card uses against its budget. */
export interface ShowTime {
  readonly used: Traced<number>;
  readonly budget: Traced<number>;
  /** How far over the budget the card is; 0 when it fits. */
  readonly over: number;
  /** True when the booker set any segment longer than its usual class. */
  readonly lengthened: boolean;
}

function placeOf(segment: DeepReadonly<Segment>): string {
  return segment.preShow
    ? `Pre-show ${String(segment.slot + 1)}`
    : `Slot ${String(segment.slot + 1)}`;
}

/** The time a show's card uses and has, read from its stored segments. */
export function showTimeOf(
  read: GameWorldView,
  instance: DeepReadonly<EventInstance>,
  tunables: EngineTunables,
): ShowTime {
  const segments = [...read.tables.segments.lookup('byEventInstance', instance.id)].sort(
    (left, right) => Number(right.preShow) - Number(left.preShow) || left.slot - right.slot,
  );
  const timed: TimedSlot[] = [];
  let lengthened = false;
  for (const segment of segments) {
    const duration = segmentDurationOf(read, segment, instance.format, tunables);
    if (duration === null) {
      continue;
    }
    lengthened ||= duration.steps > 0;
    timed.push({ place: placeOf(segment), durationClass: duration.duration.value });
  }
  const used = cardTimeUsed(timed, { tunables });
  const budget = showTimeBudget(
    { importance: instance.importance, roles: formatRoles(instance.format, tunables) },
    { tunables },
  );
  return { used, budget, over: Math.max(0, used.value - budget.value), lengthened };
}

/** "Over the show's time by 2: shorten a match or drop a segment." */
export function overTimeMessage(over: number): string {
  return `Over the show's time by ${String(over)}: shorten a match or drop a segment.`;
}
