import type { ShowCardSegment, ShowCardSide, ShowCardSlot } from '@ringside/engine';
import type { CardSlotChip, CardSlotSide } from '@/components/CardSlot';
import { CARD_SLOT_ROLES } from '@/screens/booking/cardSlotProps';
import type { CardSlotViewProps } from '@/screens/booking/cardSlotProps';

/** The tag over a side that held one of the match's titles going into the show. */
export const CHAMPIONS_LABEL = 'Champions';

const RESULT_LABELS: Readonly<
  Record<Exclude<NonNullable<ShowCardSegment['outcome']>['kind'], 'win'>, string>
> = {
  draw: 'Draw',
  noContest: 'No contest',
};

function chipsOf(segment: ShowCardSegment): CardSlotChip[] {
  return [
    { id: 'type', kind: 'match-type', label: segment.typeName },
    ...segment.titles.map((title): CardSlotChip => ({
      id: `title-${title.titleId}`,
      kind: 'title',
      label: title.name,
    })),
    ...segment.storylines.map((storyline): CardSlotChip => ({
      id: `storyline-${storyline.storylineId}`,
      kind: 'storyline',
      label: storyline.name,
    })),
  ];
}

function sideOf(side: ShowCardSide): CardSlotSide {
  // A team's wrestlers go under its name, so the card never shows only the team.
  const members =
    side.teamId === null || side.people.length === 0
      ? null
      : side.people.map((person) => person.name).join(' & ');
  return {
    name: side.name,
    ...(side.isChampions ? { label: CHAMPIONS_LABEL } : {}),
    ...(members === null ? {} : { detail: members }),
    members: side.people.map((person) => ({
      kind: 'person' as const,
      id: person.personId,
      name: person.name,
      ...(person.imageRef === null ? {} : { imageRef: person.imageRef }),
    })),
  };
}

/**
 * One slot of `aip.showCards` as `CardSlot` draws it: role and number, chips for the match or
 * talking segment type, each title and each storyline, the sides (with "Champions" over the title
 * holders) and the result when there is one. An open slot has no chips and no sides.
 */
export function toRivalCardSlotProps(slot: ShowCardSlot): CardSlotViewProps {
  const base = {
    slotRole: CARD_SLOT_ROLES[slot.role],
    slotNumber: slot.displayNumber,
    roleLabel: slot.roleLabel,
  };
  const { segment } = slot;
  if (segment === null) return { ...base, chips: [], sides: [] };

  const chips = chipsOf(segment);
  const sides = segment.sides.map(sideOf);
  const { outcome } = segment;
  if (outcome === null) return { ...base, chips, sides };
  if (outcome.kind === 'win') {
    const index = outcome.winningSide;
    return index === null || index < 0 || index >= sides.length
      ? { ...base, chips, sides }
      : { ...base, chips, sides, winnerIndex: index };
  }
  return { ...base, chips, sides, resultLabel: RESULT_LABELS[outcome.kind] };
}

/** A key for a slot on one show's card: `pre-1`, `main-6`. */
export function rivalSlotKey(slot: Pick<ShowCardSlot, 'preShow' | 'displayNumber'>): string {
  return `${slot.preShow ? 'pre' : 'main'}-${String(slot.displayNumber)}`;
}
