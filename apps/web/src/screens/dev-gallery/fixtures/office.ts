import { ALIGNMENTS } from '@ringside/engine';
import type { Alignment } from '@ringside/engine';
import type { ChampionCardReign, ChampionCardTitle } from '@/components/ChampionCard';
import { galleryBelts, galleryPeople } from '../imageSlotFixtures';

/** A title and its reign as a titles query might return them. Gallery data only, all invented. */
export interface GalleryChampionship {
  readonly title: ChampionCardTitle;
  readonly reign: ChampionCardReign | null;
  /** 0 to 100. */
  readonly prestige: number;
}

function personAt(index: number) {
  const person = galleryPeople[index];
  if (person === undefined) throw new Error(`No gallery person at ${String(index)}.`);
  return person;
}

function titleAt(index: number): ChampionCardTitle {
  const belt = galleryBelts[index];
  if (belt === undefined) throw new Error(`No gallery belt at ${String(index)}.`);
  return {
    id: belt.id,
    name: belt.name,
    ...(belt.shortName === undefined ? {} : { shortName: belt.shortName }),
    ...(belt.tier === undefined ? {} : { tier: belt.tier }),
  };
}

/** Four titles: a long reign, a fresh one, a silver-tier title and a vacant one. */
export const galleryChampionships: readonly GalleryChampionship[] = [
  {
    title: titleAt(0),
    reign: { champion: personAt(0), days: 142, defences: 6 },
    prestige: 96,
  },
  {
    title: titleAt(1),
    reign: { champion: personAt(2), days: 1, defences: 0 },
    prestige: 78,
  },
  {
    title: titleAt(2),
    reign: { champion: personAt(10), days: 215, defences: 9 },
    prestige: 61,
  },
  { title: titleAt(3), reign: null, prestige: 44 },
];

/** Eight weeks of TV viewers, in millions, oldest first. */
export const GALLERY_VIEWER_WEEKS: readonly number[] = [
  0.82, 0.86, 0.85, 0.91, 0.94, 1.02, 0.99, 1.1,
];

/** Eight weeks of attendance as a share of capacity, oldest first. */
export const GALLERY_ATTENDANCE_WEEKS: readonly number[] = [
  0.81, 0.84, 0.88, 0.86, 0.9, 0.89, 0.91, 0.92,
];

/** Eight weeks of locker room morale, falling. */
export const GALLERY_MORALE_WEEKS: readonly number[] = [88, 87, 85, 86, 83, 82, 82, 81];

/** A roster analytics row, as a roster query might return it. Gallery data only. */
export interface GalleryRosterLeader {
  readonly id: string;
  readonly name: string;
  readonly alignment: Alignment;
  readonly cardPosition: string;
  /** 0 to 100. */
  readonly popularity: number;
  /** Change in popularity this month. */
  readonly momentum: number;
  /** 0 to 100. */
  readonly morale: number;
  /** Months left on the contract. */
  readonly contractMonths: number;
}

const CARD_POSITIONS: readonly string[] = [
  'Main event',
  'Main event',
  'Upper mid',
  'Upper mid',
  'Midcard',
  'Midcard',
  'Lower mid',
  'Opener',
];

/** Eight roster leaders, values spread with fixed arithmetic, never randomness. */
export const galleryRosterLeaders: readonly GalleryRosterLeader[] = CARD_POSITIONS.map(
  (cardPosition, index) => {
    const person = personAt(index * 3);
    return {
      id: person.id,
      name: person.name,
      alignment: ALIGNMENTS[index % ALIGNMENTS.length] ?? 'face',
      cardPosition,
      popularity: 88 - index * 3,
      momentum: ((index * 7) % 15) - 4,
      morale: 94 - ((index * 11) % 25),
      contractMonths: ((index * 5) % 22) + 2,
    };
  },
);
