import type { BookingIssue, BookingResultView, BookingSlotView, SlotRole } from '@ringside/engine';
import type {
  CardSlotChip,
  CardSlotIssues,
  CardSlotRole,
  CardSlotSide,
} from '@/components/CardSlot';

/** The engine's slot roles as `CardSlot` names them. */
export const CARD_SLOT_ROLES: Readonly<Record<SlotRole, CardSlotRole>> = {
  preShow: 'pre-show',
  opener: 'opener',
  midcard: 'midcard',
  semiMain: 'semi-main',
  mainEvent: 'main-event',
};

/** The part of `CardSlotProps` that comes straight from one slot of `booking.card`. */
export interface CardSlotViewProps {
  readonly slotRole: CardSlotRole;
  readonly slotNumber: number;
  readonly roleLabel: string;
  readonly chips: readonly CardSlotChip[];
  /** Empty for an open slot. */
  readonly sides: readonly CardSlotSide[];
  readonly winnerIndex?: number;
  readonly resultLabel?: string;
}

const RESULT_LABELS: Readonly<Record<Exclude<BookingResultView['kind'], 'win'>, string>> = {
  draw: 'Draw',
  noContest: 'No contest',
};

/** What a slot looks like on the card: role, number, chips, sides and the planned result. */
export function toCardSlotProps(slot: BookingSlotView): CardSlotViewProps {
  const base = {
    slotRole: CARD_SLOT_ROLES[slot.role],
    slotNumber: slot.displayNumber,
    roleLabel: slot.roleLabel,
  };
  const { segment } = slot;
  if (segment === null) return { ...base, chips: [], sides: [] };

  const chips: CardSlotChip[] = [
    { id: 'type', kind: 'match-type', label: segment.typeName },
    ...segment.titles.map((title): CardSlotChip => ({
      id: `title-${title.titleId}`,
      kind: 'title',
      label: title.name,
    })),
  ];
  const sides = segment.sides.map((side): CardSlotSide => ({
    name: side.name,
    members: side.people.map((person) => ({
      kind: 'person' as const,
      id: person.personId,
      name: person.ringName,
      ...(person.imageRef === null ? {} : { imageRef: person.imageRef }),
    })),
  }));
  const { result } = segment;
  if (result === null) return { ...base, chips, sides };
  if (result.kind === 'win') {
    const winnerIndex = segment.sides.findIndex((side) => side.side === result.winningSide);
    return winnerIndex < 0 ? { ...base, chips, sides } : { ...base, chips, sides, winnerIndex };
  }
  return { ...base, chips, sides, resultLabel: RESULT_LABELS[result.kind] };
}

/** A key for a slot's place on the card: `pre-0`, `main-5`. */
export function slotKey(preShow: boolean, slot: number): string {
  return `${preShow ? 'pre' : 'main'}-${String(slot)}`;
}

/** How many errors and warnings the checks found on each slot, by `slotKey`. */
export function issuesBySlot(
  errors: readonly BookingIssue[],
  warnings: readonly BookingIssue[],
): ReadonlyMap<string, CardSlotIssues> {
  const counts = new Map<string, { errors: number; warnings: number }>();
  const add = (issue: BookingIssue, field: 'errors' | 'warnings'): void => {
    if (issue.slot === undefined) return;
    const key = slotKey(issue.slot.preShow, issue.slot.slot);
    const count = counts.get(key) ?? { errors: 0, warnings: 0 };
    count[field] += 1;
    counts.set(key, count);
  };
  for (const issue of errors) add(issue, 'errors');
  for (const issue of warnings) add(issue, 'warnings');
  return counts;
}
