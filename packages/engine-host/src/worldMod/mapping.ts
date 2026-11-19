/**
 * Every enum and scale of a workshop world mod mapped onto the engine's, in one place. The
 * converter's mappers read only these tables; a source value missing from a table maps to the
 * stated default and is reported once as an `unknown-value` warning.
 *
 * The field-by-field mapping is written up in game/docs/world-mod-import.md.
 */

import type {
  Alignment,
  Build,
  EventImportance,
  Gender,
  Motivation,
  PersonRole,
  PersonStatus,
  PromotionStyle,
  Push,
  RingStyle,
  TraitKey,
  VenueKind,
} from '@ringside/engine';

/** Looks `value` up case-insensitively; `undefined` when the table has no entry. */
export function lookup<T>(table: Readonly<Record<string, T>>, value: string): T | undefined {
  const key = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Mod continent names to the base pack's continent keys. */
export const CONTINENTS: Readonly<Record<string, string>> = {
  'north america': 'na',
  'south america': 'sa',
  'latin america': 'sa',
  'central america': 'sa',
  europe: 'eu',
  asia: 'as',
  'middle east': 'as',
  africa: 'af',
  oceania: 'oc',
  australia: 'oc',
};

/** The six continent popularity columns of people and promotions, by base continent key. */
export const CONTINENT_POP_COLUMNS: readonly (readonly [string, string])[] = [
  ['na', 'northAmericaPop'],
  ['sa', 'southAmericaPop'],
  ['eu', 'europePop'],
  ['as', 'asiaPop'],
  ['af', 'africaPop'],
  ['oc', 'oceaniaPop'],
];

/** Other spellings of the base pack's country names, normalised (see `normaliseName`). */
export const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  usa: 'unitedstates',
  unitedstatesofamerica: 'unitedstates',
  america: 'unitedstates',
  uk: 'unitedkingdom',
  greatbritain: 'unitedkingdom',
  britain: 'unitedkingdom',
  england: 'unitedkingdom',
  scotland: 'unitedkingdom',
  wales: 'unitedkingdom',
  northernireland: 'unitedkingdom',
  korea: 'southkorea',
  republicofkorea: 'southkorea',
  uae: 'unitedarabemirates',
  holland: 'netherlands',
  thenetherlands: 'netherlands',
  peoplesrepublicofchina: 'china',
};

/** Lowercase letters and digits only, for matching names across sources. */
export function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const PERSON_STATUSES: Readonly<Record<string, PersonStatus>> = {
  active: 'active',
  'on hiatus': 'hiatus',
  hiatus: 'hiatus',
  retired: 'retired',
  'semi-active': 'semiRetired',
  'semi-retired': 'semiRetired',
  dead: 'deceased',
  deceased: 'deceased',
  'out of the business': 'outOfBusiness',
};

export const GENDERS: Readonly<Record<string, Gender>> = {
  male: 'male',
  female: 'female',
  nb: 'nonBinary',
  'non-binary': 'nonBinary',
  nonbinary: 'nonBinary',
};

/** Person type to the engine role. Wrestlers keep a ring style; everyone else is a non-wrestler. */
export const PERSON_ROLES: Readonly<Record<string, PersonRole>> = {
  wrestler: 'wrestler',
  'occasional wrestler': 'occasionalWrestler',
  referee: 'referee',
  announcer: 'announcer',
  staff: 'producer',
  personality: 'manager',
};

export const RING_STYLES: Readonly<Record<string, RingStyle>> = {
  entertainer: 'showman',
  technical: 'technician',
  traditional: 'allRounder',
  'high flyer': 'highFlyer',
  brawler: 'brawler',
  powerhouse: 'powerhouse',
  hardcore: 'hardcore',
  'lucha libre': 'highFlyer',
  'mixed martial arts': 'striker',
  'strong style': 'striker',
  striker: 'striker',
  suplex: 'grappler',
  submission: 'grappler',
  'non-wrestler': 'nonWrestler',
};

export const BUILDS: Readonly<Record<string, Build>> = {
  skinny: 'slim',
  toned: 'lean',
  average: 'average',
  ripped: 'athletic',
  muscular: 'muscular',
  bulky: 'stocky',
  flabby: 'heavy',
  obese: 'superHeavy',
};

/** Height words to centimetres for men; women are `FEMALE_HEIGHT_OFFSET_CM` shorter. */
export const HEIGHTS_CM: Readonly<Record<string, number>> = {
  'very short': 165,
  short: 172,
  'below average': 178,
  average: 183,
  'above average': 188,
  tall: 195,
  giant: 208,
};
export const DEFAULT_HEIGHT_CM = 183;
export const FEMALE_HEIGHT_OFFSET_CM = 13;

/** Weight classes to kilograms. */
export const WEIGHTS_KG: Readonly<Record<string, number>> = {
  featherweight: 68,
  lightweight: 77,
  cruiserweight: 88,
  'light heavyweight': 100,
  heavyweight: 118,
  'super heavyweight': 150,
};
export const DEFAULT_WEIGHT_KG = 100;
/** Women's weights are scaled by this (the mods use the same class words for everyone). */
export const FEMALE_WEIGHT_FACTOR = 0.78;

/** A title's weight limit word to a maximum weight in kilograms. */
export const TITLE_WEIGHT_LIMITS_KG: Readonly<Record<string, number>> = {
  featherweight: 70,
  lightweight: 80,
  cruiserweight: 93,
  'light heavyweight': 102,
  heavyweight: 125,
};

export const MOTIVATIONS: Readonly<Record<string, Motivation>> = {
  best: 'legacy',
  legacy: 'legacy',
  fun: 'enjoyment',
  thrill: 'thrill',
  money: 'money',
  power: 'power',
};
/** For people with no drive set: picked by worker id, so it is stable across imports. */
export const FALLBACK_MOTIVATIONS: readonly Motivation[] = [
  'enjoyment',
  'money',
  'legacy',
  'enjoyment',
  'money',
  'thrill',
  'power',
];

/**
 * Personality flags to engine traits, in priority order: the first eight a person holds are kept,
 * and a trait that clashes with one already kept is dropped.
 */
export const TRAIT_FLAGS: readonly (readonly [string, TraitKey])[] = [
  ['quickLearner', 'fastLearner'],
  ['slowLearner', 'slowLearner'],
  ['injuryProne', 'injuryProne'],
  ['tough', 'durable'],
  ['maximumEffort', 'workhorse'],
  ['minimumEffort', 'coaster'],
  ['slowDecliner', 'agesWell'],
  ['fastDecliner', 'agesBadly'],
  ['greatSeller', 'generousSeller'],
  ['badSeller', 'poorSeller'],
  ['tagExpert', 'tagSpecialist'],
  ['teacher', 'teacher'],
  ['leader', 'leader'],
  ['respectful', 'professional'],
  ['narcissist', 'egotist'],
  ['partyAnimal', 'partier'],
  ['prankster', 'prankster'],
  ['sensitive', 'sensitive'],
  ['lifer', 'loyal'],
  ['lovesHardcore', 'lovesHardcore'],
  ['hatesHardcore', 'refusesHardcore'],
  ['deathmatch', 'lovesHardcore'],
  ['lovesComedy', 'lovesComedy'],
  ['hatesComedy', 'refusesComedy'],
  ['angry', 'troublemaker'],
  ['explosive', 'troublemaker'],
];

/** Worker columns that have no home in the engine, listed once in the report. */
export const PERSON_COLUMNS_NOT_IMPORTED: readonly string[] = [
  'description',
  'race',
  'sexuality',
  'politics',
  'defaultEntrance',
  'moveset',
  'skillPreference1-3',
  'fatigue',
  'injuryType/injuryHealDate',
  'isInRehab/rehabReturnDate',
  'isSuspended/suspensionReturnDate',
  'personality flags with no engine trait (anxious, sociable, annoying, creepy, loner, charitable, fitnessFanatic, outsideInterests, outspoken, oldSchool, inOutsideRelationship, lovesIntergender, hatesIntergender, bumps, isCelebrity)',
];

export const ALIGNMENTS: Readonly<Record<string, Alignment>> = {
  face: 'face',
  heel: 'heel',
  tweener: 'tweener',
};

export const PUSHES: Readonly<Record<string, Push>> = {
  'main event': 'mainEvent',
  'upper midcard': 'upperCard',
  midcard: 'midCard',
  'mid card': 'midCard',
  'lower midcard': 'lowerCard',
  opener: 'lowerCard',
  'enhancement talent': 'enhancement',
  jobber: 'enhancement',
  referee: 'none',
  staff: 'none',
  announcer: 'none',
  personality: 'none',
};

export const PROMOTION_STYLES: Readonly<Record<string, PromotionStyle>> = {
  'sports entertainment': 'entertainment',
  entertainment: 'entertainment',
  'strong style': 'hardHitting',
  'kings road': 'hardHitting',
  traditional: 'traditional',
  'lucha libre': 'highFlying',
  hardcore: 'hardcore',
  'pure wrestling': 'technical',
  technical: 'technical',
  mainstream: 'mainstream',
};

/** Expense policy words to the engine's 0-3 tiers. */
export const POLICY_TIERS: Readonly<Record<string, number>> = {
  none: 0,
  low: 1,
  basic: 1,
  medium: 2,
  standard: 2,
  high: 3,
  premium: 3,
};

export const EVENT_IMPORTANCES: Readonly<Record<string, EventImportance>> = {
  huge: 'flagship',
  high: 'major',
  normal: 'regular',
  low: 'minor',
  unimportant: 'house',
};

/** Main-card and pre-show slots per importance (the engine's suggested defaults). */
export const SHOW_FORMATS: Readonly<
  Record<EventImportance, { readonly slots: number; readonly preShowSlots: number }>
> = {
  house: { slots: 5, preShowSlots: 0 },
  minor: { slots: 5, preShowSlots: 0 },
  regular: { slots: 6, preShowSlots: 0 },
  major: { slots: 8, preShowSlots: 1 },
  flagship: { slots: 10, preShowSlots: 2 },
};

/** Weekday columns of the events table, in the engine's order (0 = Monday). */
export const WEEKDAY_COLUMNS: readonly string[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export const WEEKDAYS: Readonly<Record<string, number>> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

export const TIMESLOTS: Readonly<
  Record<string, 'daytime' | 'evening' | 'primeTime' | 'lateNight'>
> = {
  daytime: 'daytime',
  morning: 'daytime',
  afternoon: 'daytime',
  'early evening': 'evening',
  evening: 'evening',
  'prime time': 'primeTime',
  'late night': 'lateNight',
};

export const NETWORK_KINDS: Readonly<Record<string, 'tv' | 'ppv' | 'streaming'>> = {
  'tv network': 'tv',
  tv: 'tv',
  ppv: 'ppv',
  'pay per view': 'ppv',
  'online both': 'streaming',
  'online on demand': 'streaming',
  'online streaming': 'streaming',
};

/** Venue types; an indoor arena is a stadium, arena or hall by capacity. */
export function venueKind(type: string | null, capacity: number): VenueKind {
  const lowered = (type ?? '').toLowerCase();
  if (lowered.startsWith('outdoor')) return capacity >= 30_000 ? 'stadium' : 'outdoor';
  if (lowered === 'studio' || lowered === 'tv studio') return 'studio';
  if (lowered === 'theatre' || lowered === 'theater') return 'theatre';
  if (capacity >= 40_000) return 'stadium';
  if (capacity >= 5_000) return 'arena';
  return 'hall';
}

/** Colours for promotions and titles, picked by source id so re-imports keep them. */
export const PALETTE: readonly string[] = [
  '#b91c1c',
  '#1d4ed8',
  '#047857',
  '#a16207',
  '#7c3aed',
  '#be185d',
  '#0e7490',
  '#4d7c0f',
  '#c2410c',
  '#4338ca',
  '#0f766e',
  '#9f1239',
];

/** Tables that are game state, not world: a fresh mod leaves them empty. */
export const STATE_TABLES: readonly string[] = [
  'segments',
  'eventinstance',
  'emails',
  'news',
  'finances',
  'financehistory',
  'saveinfo',
  'storylines',
  'storylinehistories',
  'storylineworkers',
  'tournaments',
  'promises',
  'currentbooking',
  'aiChatMessages',
  'contractoffers',
  'workerhistory',
  'workerhistoryv2',
];

/** World tables the engine has no record kind for yet; reported as not imported when non-empty. */
export const TABLES_NOT_IMPORTED: readonly string[] = [
  'stables',
  'stableworkers',
  'relationships',
  'chemistry',
  'alteregos',
  'gimmicks',
  'matchgimmicks',
  'angleTemplates',
  'templateBeats',
  'randomEvent',
  'futurePics',
  'futureowners',
  'promotionrelationships',
];
