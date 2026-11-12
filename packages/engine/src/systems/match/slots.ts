/**
 * Slot role, duration class and slot weight (D-10).
 *
 * You never set minutes. A segment's position on the card decides its role, the role implies a
 * duration class and a weight, and a match type may move the class one step. None of it is stored:
 * every caller derives it on demand, so reordering a card can never leave a stale role behind.
 *
 * Design: docs/design/match-rating.md#slots.
 */

import { startCalc, startDecision, type Traced } from '../../core/trace';
import type { MatchTypeDef } from '../../model/catalogs';
import type { EngineTunables, TunableKey } from '../tunables';

/** The roles a slot can have, in card order. */
export const SLOT_ROLES = ['preShow', 'opener', 'midcard', 'semiMain', 'mainEvent'] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

/** How long a segment runs, without minutes. Shortest first. */
export const DURATION_CLASSES = ['short', 'standard', 'long'] as const;
export type DurationClass = (typeof DURATION_CLASSES)[number];

/** The role names as the player reads them. */
export const SLOT_ROLE_LABELS: Readonly<Record<SlotRole, string>> = {
  preShow: 'Pre-show',
  opener: 'Opener',
  midcard: 'Midcard',
  semiMain: 'Semi-main',
  mainEvent: 'Main event',
};

/** The duration class names as the player reads them. */
export const DURATION_CLASS_LABELS: Readonly<Record<DurationClass, string>> = {
  short: 'Short',
  standard: 'Standard',
  long: 'Long',
};

export const SLOTS_DOC_REF = 'match-rating.md#slots';

/** Where a segment sits. Slots are 1-based and counted separately for the pre-show. */
export interface SlotPosition {
  /** The segment's slot: 1..`slots` on the main card, 1 or more on the pre-show. */
  slot: number;
  /** How many slots the main card has. */
  slots: number;
  /** True for a pre-show slot. */
  preShow: boolean;
}

/** What `durationClassOf` needs. */
export interface DurationClassInputs {
  role: SlotRole;
  /** The segment's match type, or null for a talking segment (no shift). */
  matchType: Pick<MatchTypeDef, 'name' | 'durationShift'> | null;
}

/** What `slotWeightOf` needs. */
export interface SlotWeightInputs {
  role: SlotRole;
}

export interface SlotDeps {
  tunables: EngineTunables;
}

type ShiftableRole = Exclude<SlotRole, 'mainEvent'>;

const DURATION_CLASS_KEYS = {
  preShow: 'match.slot.durationClass.preShow',
  opener: 'match.slot.durationClass.opener',
  midcard: 'match.slot.durationClass.midcard',
  semiMain: 'match.slot.durationClass.semiMain',
} as const satisfies Readonly<Record<ShiftableRole, TunableKey>>;

const WEIGHT_KEYS = {
  preShow: 'match.slot.weight.preShow',
  opener: 'match.slot.weight.opener',
  midcard: 'match.slot.weight.midcard',
  semiMain: 'match.slot.weight.semiMain',
  mainEvent: 'match.slot.weight.mainEvent',
} as const satisfies Readonly<Record<SlotRole, TunableKey>>;

function isWholeNumber(value: number): boolean {
  return Number.isSafeInteger(value);
}

function checkPosition({ slot, slots, preShow }: SlotPosition): void {
  if (!isWholeNumber(slots) || slots < 1) {
    throw new RangeError(
      `slotRoleOf: slots must be a whole number of at least 1, got ${String(slots)}`,
    );
  }
  if (!isWholeNumber(slot) || slot < 1) {
    throw new RangeError(
      `slotRoleOf: slot must be a whole number of at least 1, got ${String(slot)}`,
    );
  }
  if (!preShow && slot > slots) {
    throw new RangeError(
      `slotRoleOf: slot ${String(slot)} is past the last of ${String(slots)} main-card slots`,
    );
  }
}

/**
 * The role a slot's position gives it. Rules, first match wins: a pre-show slot is `preShow`; the
 * last main-card slot is the `mainEvent`; the slot before it is the `semiMain` when the card has at
 * least `match.slot.semiMainFromSlots` slots; slot 1 is the `opener`; anything else is `midcard`.
 *
 * Throws `RangeError` for a slot outside the card; callers validate first.
 */
export function slotRoleOf(position: SlotPosition, deps: SlotDeps): Traced<SlotRole> {
  checkPosition(position);
  const { slot, slots, preShow } = position;
  const decision = startDecision<SlotRole>('Slot role', { docRef: SLOTS_DOC_REF });
  const where = preShow
    ? `Pre-show slot ${String(slot)}`
    : `Slot ${String(slot)} of ${String(slots)}`;
  decision.note(where);

  decision.rule('On the pre-show', preShow);
  if (preShow) {
    return decision.choose('preShow', 'On the pre-show');
  }
  const last = slot === slots;
  decision.rule('Last slot of the main card', last);
  if (last) {
    return decision.choose('mainEvent', 'Last slot of the main card');
  }
  const semiMainFrom = decision.tunable(
    deps.tunables,
    'match.slot.semiMainFromSlots',
    'Smallest main card with a semi-main',
  );
  const semiMain = slot === slots - 1 && slots >= semiMainFrom;
  const semiMainRule = `Slot before the main event on a card of ${String(semiMainFrom)} or more slots`;
  decision.rule(semiMainRule, semiMain);
  if (semiMain) {
    return decision.choose('semiMain', semiMainRule);
  }
  const first = slot === 1;
  decision.rule('First slot of the main card', first);
  if (first) {
    return decision.choose('opener', 'First slot of the main card');
  }
  return decision.choose('midcard', 'Between the opener and the top of the card');
}

function classAt(index: number): DurationClass {
  const clamped = Math.min(Math.max(index, 0), DURATION_CLASSES.length - 1);
  return DURATION_CLASSES[clamped] ?? 'standard';
}

/**
 * The duration class a role implies, moved one step by the match type. The main event is always
 * long (D-10), so a downward shift there is ignored. A talking segment (no match type) is never
 * shifted. The shift never goes past short or long.
 */
export function durationClassOf(
  inputs: DurationClassInputs,
  deps: SlotDeps,
): Traced<DurationClass> {
  const { role, matchType } = inputs;
  const roleLabel = SLOT_ROLE_LABELS[role];
  const decision = startDecision<DurationClass>('Duration class', { docRef: SLOTS_DOC_REF });

  let base: DurationClass;
  if (role === 'mainEvent') {
    base = 'long';
    decision.note('D-10: the main event is always the long slot');
  } else {
    const key = DURATION_CLASS_KEYS[role];
    base = deps.tunables.get(key);
    decision.tunable(deps.tunables, key, `${roleLabel} → ${DURATION_CLASS_LABELS[base]}`);
  }

  if (matchType === null) {
    decision.note('Talking segment: no match type to shift it');
    return decision.choose(base, `${roleLabel} → ${DURATION_CLASS_LABELS[base]}`);
  }
  const shift = matchType.durationShift;
  if (shift === 0) {
    decision.note(`${matchType.name} keeps the slot's class`);
    return decision.choose(base, `${roleLabel} → ${DURATION_CLASS_LABELS[base]}`);
  }
  if (role === 'mainEvent' && shift < 0) {
    decision.rule(`${matchType.name} would pull it down a step`, true);
    decision.rule('Main event stays long', true);
    return decision.choose('long', 'Main event stays long');
  }
  const baseIndex = DURATION_CLASSES.indexOf(base);
  const shifted = classAt(baseIndex + shift);
  const direction = shift > 0 ? 'pushes it up a step' : 'pulls it down a step';
  if (shifted === base) {
    const edge = shift > 0 ? 'the longest' : 'the shortest';
    const because = `${matchType.name} ${direction}, but ${DURATION_CLASS_LABELS[base]} is already ${edge}`;
    decision.rule(because, false);
    return decision.choose(base, because);
  }
  const because = `${matchType.name} ${direction} → ${DURATION_CLASS_LABELS[shifted]}`;
  decision.rule(because, true);
  return decision.choose(shifted, because);
}

/**
 * How much a role counts toward the show score: its `match.slot.weight.<role>` tunable. The main
 * event never weighs less than any other role, whatever the overrides say (D-10). A weight of 0
 * makes the role count for nothing.
 */
export function slotWeightOf(inputs: SlotWeightInputs, deps: SlotDeps): Traced<number> {
  const { role } = inputs;
  const label = SLOT_ROLE_LABELS[role];
  const calc = startCalc(`${label} weight`, 0, {
    startLabel: 'No weight',
    unit: 'multiplier',
    docRef: SLOTS_DOC_REF,
  });
  calc.add(`${label} weight`, calc.tunable(deps.tunables, WEIGHT_KEYS[role], `${label} weight`));
  if (role !== 'mainEvent') {
    return calc.done();
  }
  const heaviest = startCalc('Heaviest other slot', 0, {
    startLabel: 'No weight',
    unit: 'multiplier',
  });
  for (const other of SLOT_ROLES) {
    if (other === 'mainEvent') {
      continue;
    }
    const otherLabel = SLOT_ROLE_LABELS[other];
    heaviest.max(
      `${otherLabel} weight`,
      heaviest.tunable(deps.tunables, WEIGHT_KEYS[other], `${otherLabel} weight`),
    );
  }
  return calc.max('The main event never weighs less than another slot', heaviest.done()).done();
}
