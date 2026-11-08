/**
 * Generated subjects for the placeholder art entries. A "regenerate" button moves to the next
 * seed, which gives new names and new ids, so the art shows its variety. The picks come from the
 * engine's seeded RNG, so one seed always gives the same set.
 *
 * Every name is invented. None of them is a real performer, promotion or title.
 */
import { intBetween, pick, RngRegistry } from '@ringside/engine';
import type { ImageSubject, ImageTier } from '@/components/ImageSlot';

declare module '@ringside/engine' {
  interface StreamNames {
    'gallery.art': true;
  }
}

const FIRST_NAMES: readonly string[] = [
  'Ada',
  'Bram',
  'Cass',
  'Dario',
  'Elif',
  'Fen',
  'Gus',
  'Hana',
  'Idris',
  'Jory',
  'Kaia',
  'Lio',
  'Mara',
  'Nico',
  'Oona',
  'Pax',
  'Quill',
  'Rhea',
  'Sol',
  'Tamsin',
  'Ugo',
  'Vesna',
  'Wim',
  'Yara',
];

const LAST_NAMES: readonly string[] = [
  'Ashdown',
  'Brightwater',
  'Castellan',
  'Drummond',
  'Ekwueme',
  'Falkner',
  'Galloway',
  'Hartigan',
  'Iwu',
  'Kestrel',
  'Lindqvist',
  'Moreau',
  'Navarro-Kent',
  'Okonkwo',
  'Pellegrino',
  'Ravensworth',
  'Szabo',
  'Thorne',
  'Vasquez',
  'Whitcombe',
];

/** One-word or "The ..." ring names, which test initials for unusual shapes. */
const RING_NAMES: readonly string[] = [
  'The Lighthouse Keeper',
  'Static',
  'The Quiet Storm',
  'Ironbark',
  'Señor Medianoche',
  'The Copper Fox',
  'Lantern',
  'Mister Overtime',
];

const PLACES: readonly string[] = [
  'Harbour',
  'Northgate',
  'Red Mesa',
  'Saltmarsh',
  'Ironwood',
  'Lakeshore',
  'Granite Bay',
  'Westbridge',
  'Summit',
  'Coldwater',
];

const TITLE_NAMES: readonly string[] = [
  'Heavyweight',
  'Crown',
  'Television',
  'Tag Team',
  'Heritage',
  'Openweight',
  'Breakout',
  'Legacy',
];

const PROMOTION_WORDS: readonly string[] = [
  'Wrestling',
  'Pro Wrestling',
  'Grappling Club',
  'Championship Wrestling',
  'Fight League',
  'Wrestling Alliance',
];

const TIERS: readonly ImageTier[] = ['gold', 'silver', 'bronze', 'plain'];

/** Seed text for a regenerate cycle, shown on screen so a set can be found again. */
export function artSeed(cycle: number): string {
  return `gallery-art-${String(cycle)}`;
}

function artStream(cycle: number) {
  return new RngRegistry(artSeed(cycle)).stream('gallery.art');
}

function sampleId(prefix: string, cycle: number, index: number): string {
  return `${prefix}_${String(cycle).padStart(3, '0')}${String(index).padStart(3, '0')}`;
}

function acronym(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}

/** People: mostly first and last names, with a ring name roughly one time in four. */
export function generatePeople(cycle: number, count: number): readonly ImageSubject[] {
  const stream = artStream(cycle);
  return Array.from({ length: count }, (_, index) => {
    const name =
      intBetween(stream, 1, 4) === 1
        ? pick(stream, RING_NAMES)
        : `${pick(stream, FIRST_NAMES)} ${pick(stream, LAST_NAMES)}`;
    return { kind: 'person', id: sampleId('per', cycle, index), name };
  });
}

/** Titles: one of each belt tier in turn, with a short name on about half of them. */
export function generateTitles(cycle: number, count: number): readonly ImageSubject[] {
  const stream = artStream(cycle);
  return Array.from({ length: count }, (_, index) => {
    const place = pick(stream, PLACES);
    const titleName = pick(stream, TITLE_NAMES);
    const tier = TIERS[index % TIERS.length] ?? 'plain';
    const hasShortName = intBetween(stream, 0, 1) === 1;
    return {
      kind: 'title',
      id: sampleId('tit', cycle, index),
      name: `${place} ${titleName} Championship`,
      tier,
      ...(hasShortName ? { shortName: `${place} ${titleName}` } : {}),
    };
  });
}

/** Promotions: a place and a kind of company, with an acronym on about half of them. */
export function generatePromotions(cycle: number, count: number): readonly ImageSubject[] {
  const stream = artStream(cycle);
  return Array.from({ length: count }, (_, index) => {
    const name = `${pick(stream, PLACES)} ${pick(stream, PROMOTION_WORDS)}`;
    const hasAcronym = intBetween(stream, 0, 1) === 1;
    return {
      kind: 'promotion',
      id: sampleId('pro', cycle, index),
      name,
      ...(hasAcronym ? { shortName: acronym(name) } : {}),
    };
  });
}
