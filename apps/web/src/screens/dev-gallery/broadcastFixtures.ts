import type { CardSlotSide } from '@/components/CardSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import type { TickerItem } from '@/components/Ticker';
import { galleryPeople } from './imageSlotFixtures';

/** A gallery person by position, so a fixture never reads past the list. */
function person(index: number): ImageSubject {
  const subject = galleryPeople[index % galleryPeople.length];
  if (subject === undefined) {
    throw new Error('The gallery needs at least one invented person.');
  }
  return subject;
}

function single(index: number, label: string, detail: string): CardSlotSide {
  const subject = person(index);
  return { name: subject.name, label, members: [subject], detail };
}

function team(first: number, second: number, label: string, detail: string): CardSlotSide {
  const firstMember = person(first);
  const secondMember = person(second);
  return {
    name: `${firstMember.name} & ${secondMember.name}`,
    label,
    members: [firstMember, secondMember],
    detail,
  };
}

/** Invented matchups for the CardSlot entry. */
export const BROADCAST_SIDES = {
  openerFace: single(0, 'Face', 'Momentum 88 · Stamina 94%'),
  openerHeel: single(6, 'Heel', 'Momentum 76 · Stamina 90%'),
  tagChampions: team(7, 10, 'Champions', 'Reign: day 112'),
  tagChallengers: team(14, 19, 'Challengers', 'Team heat 74'),
  promo: single(12, 'Contender', 'Mic skill 91 · Charisma 94'),
  mainChampion: single(4, 'Champion', 'Reign: 242 days'),
  mainChallenger: single(20, 'Challenger', 'Tournament winner'),
} as const;

/** Invented headlines for the Ticker entry. */
export const BROADCAST_HEADLINES: readonly TickerItem[] = [
  {
    id: 'signing',
    tag: 'Signing',
    tagTone: 'prestige',
    content: `${person(12).name} signs a two-year deal`,
  },
  {
    id: 'rival',
    tag: 'Rival',
    tagTone: 'action',
    content: 'Rival show draws its best crowd in a year',
  },
  { id: 'injury', content: `${person(10).name} out three weeks with a knee sprain` },
  { id: 'title', tag: 'Title', tagTone: 'data', content: 'Coastal Crown defence set for Thursday' },
];
