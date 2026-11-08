import { ALIGNMENTS } from '@ringside/engine';
import type { Alignment } from '@ringside/engine';
import type { CardSlotChip, CardSlotRole, CardSlotSide } from '@/components/CardSlot';
import type { ChampionCardReign, ChampionCardTitle } from '@/components/ChampionCard';
import type { ImageSubject } from '@/components/ImageSlot';

/**
 * Invented figures for the placeholder dashboard. The office screen shows them so the look can be
 * judged before the engine has a promotion's real numbers; the screen says so in a banner. None of
 * these people is real, and the whole file goes when the real dashboard arrives.
 */

const SAMPLE_NAMES: readonly string[] = [
  'Dex Marrow',
  'Talia Voss',
  'The Iron Pilgrim',
  'Kai Sorensen',
  'Bram Hollow',
  'Nadia Quell',
  'Reno Castellan',
  'Juno Pike',
  'Silas Wren',
  'Cass Moreau',
  'Orrin Vale',
  'Lena Harlow',
];

export const samplePeople: readonly ImageSubject[] = SAMPLE_NAMES.map((name, index) => ({
  kind: 'person',
  id: `per_sample${String(index + 1).padStart(2, '0')}`,
  name,
}));

function samplePerson(index: number): ImageSubject {
  const person = samplePeople[index % samplePeople.length];
  if (person === undefined) throw new Error('The sample dashboard needs at least one person.');
  return person;
}

/** One number in the KPI row. */
export interface SampleKpi {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  readonly icon: 'star' | 'ticket' | 'tv' | 'money' | 'users';
  readonly delta: {
    readonly value: number;
    readonly display?: string;
    readonly suffix?: string;
    readonly goodWhen?: 'up' | 'down';
  };
  /** The last eight weeks, oldest first: shares of capacity, or viewers in millions. */
  readonly trend?: { readonly values: readonly number[]; readonly unit: 'share' | 'millions' };
  readonly footer: string;
}

export const sampleKpis: readonly SampleKpi[] = [
  {
    id: 'show-score',
    label: 'Avg show score',
    value: '74',
    icon: 'star',
    delta: { value: 3, suffix: 'vs last month' },
    footer: 'Regional benchmark 68',
  },
  {
    id: 'attendance',
    label: 'Avg attendance',
    value: '92%',
    icon: 'ticket',
    delta: { value: 0.042, display: '+4.2%' },
    trend: { values: [0.81, 0.84, 0.88, 0.86, 0.9, 0.89, 0.91, 0.92], unit: 'share' },
    footer: '8,280 / 9,000 seats',
  },
  {
    id: 'viewers',
    label: 'TV viewers',
    value: '1.1M',
    icon: 'tv',
    delta: { value: 0.08, display: '+8%' },
    trend: { values: [0.82, 0.86, 0.85, 0.91, 0.94, 1.02, 0.99, 1.1], unit: 'millions' },
    footer: 'Saturday prime time',
  },
  {
    id: 'payroll',
    label: 'Monthly payroll',
    value: '$410K',
    icon: 'money',
    delta: { value: -12_000, display: '−$12K', goodWhen: 'down' },
    footer: 'Budget cap $550K',
  },
  {
    id: 'morale',
    label: 'Locker room morale',
    value: '81',
    unit: '/100',
    icon: 'users',
    delta: { value: 1 },
    footer: 'Settled',
  },
];

/** One slot of the upcoming card. */
export interface SampleCardSlot {
  readonly slotNumber: number;
  readonly slotRole: CardSlotRole;
  readonly roleLabel?: string;
  readonly chips: readonly CardSlotChip[];
  readonly sideA?: CardSlotSide;
  readonly sideB?: CardSlotSide;
}

function single(index: number, label: string, detail: string): CardSlotSide {
  const person = samplePerson(index);
  return { name: person.name, label, members: [person], detail };
}

function team(first: number, second: number, label: string): CardSlotSide {
  const firstMember = samplePerson(first);
  const secondMember = samplePerson(second);
  return {
    name: `${firstMember.name} & ${secondMember.name}`,
    label,
    members: [firstMember, secondMember],
  };
}

export const sampleShow = {
  kicker: 'Up next // In 3 days',
  title: 'Longleaf Saturday Night',
  episode: 'Ep. 45',
  venue: 'Pinecrest Civic Arena',
  capacity: 'Capacity 9,500',
  slot: 'Saturday prime time',
  /** 0 to 100. */
  hype: 78,
  projectedGate: '$245,000',
} as const;

export const sampleCard: readonly SampleCardSlot[] = [
  {
    slotNumber: 1,
    slotRole: 'opener',
    chips: [{ id: 'type', kind: 'match-type', label: 'Tag team' }],
    sideA: team(4, 6, 'Face'),
    sideB: team(8, 10, 'Heel'),
  },
  {
    slotNumber: 2,
    slotRole: 'midcard',
    chips: [{ id: 'type', kind: 'match-type', label: 'Singles' }],
    sideA: single(3, 'Face', 'Momentum +11'),
    sideB: single(9, 'Heel', 'Momentum +1'),
  },
  {
    slotNumber: 3,
    slotRole: 'midcard',
    roleLabel: 'Promo',
    chips: [{ id: 'story', kind: 'storyline', label: 'Pilgrimage' }],
    sideA: single(2, 'Tweener', 'Mic skill 88'),
  },
  { slotNumber: 4, slotRole: 'midcard', chips: [] },
  {
    slotNumber: 5,
    slotRole: 'semi-main',
    chips: [{ id: 'type', kind: 'match-type', label: '#1 contender' }],
    sideA: single(1, 'Champion', 'Reign: 88 days'),
    sideB: single(7, 'Challenger', 'Tournament winner'),
  },
  {
    slotNumber: 6,
    slotRole: 'main-event',
    chips: [
      { id: 'type', kind: 'match-type', label: 'Singles' },
      { id: 'title', kind: 'title', label: 'Heavyweight title' },
    ],
    sideA: single(0, 'Champion', 'Reign: 142 days'),
    sideB: single(5, 'Challenger', 'Feud heat 92'),
  },
];

/** A title and its reign for the champions column. */
export interface SampleChampionship {
  readonly title: ChampionCardTitle;
  readonly reign: ChampionCardReign | null;
  readonly prestige: number;
}

export const sampleChampionships: readonly SampleChampionship[] = [
  {
    title: { id: 'tit_sample01', name: 'Longleaf Heavyweight Championship', tier: 'gold' },
    reign: { champion: samplePerson(0), days: 142, defences: 6 },
    prestige: 94,
  },
  {
    title: { id: 'tit_sample02', name: "Longleaf Women's Championship", tier: 'gold' },
    reign: { champion: samplePerson(1), days: 88, defences: 4 },
    prestige: 88,
  },
  {
    title: { id: 'tit_sample03', name: 'Longleaf Heritage Championship', tier: 'silver' },
    reign: { champion: samplePerson(2), days: 215, defences: 9 },
    prestige: 72,
  },
  {
    title: { id: 'tit_sample04', name: 'Longleaf Tag Team Championship', tier: 'gold' },
    reign: null,
    prestige: 61,
  },
];

export const sampleLastShow = {
  title: 'Pine Needle Classic',
  kicker: 'Last show // Week 10',
  rating: '78',
  stars: '3.75 stars',
  gate: '91.7%',
  gateDetail: '6,420 / 7,000',
  viewers: '1.1M',
  viewersDetail: '0.34 demo',
} as const;

/** One row of the roster leaders table. */
export interface SampleRosterLeader {
  readonly id: string;
  readonly person: ImageSubject;
  readonly alignment: Alignment;
  readonly cardPosition: string;
  readonly popularity: number;
  readonly momentum: number;
  readonly morale: number;
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

/** Eight leaders, values spread with fixed arithmetic so the page is the same on every load. */
export const sampleRosterLeaders: readonly SampleRosterLeader[] = CARD_POSITIONS.map(
  (cardPosition, index) => {
    const person = samplePerson(index);
    return {
      id: person.id,
      person,
      alignment: ALIGNMENTS[index % ALIGNMENTS.length] ?? 'face',
      cardPosition,
      popularity: 88 - index * 3,
      momentum: ((index * 7) % 15) - 4,
      morale: 94 - ((index * 11) % 25),
      contractMonths: ((index * 5) % 22) + 2,
    };
  },
);
