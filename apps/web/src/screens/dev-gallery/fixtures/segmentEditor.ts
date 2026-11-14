/**
 * A static booking card and roster for the segment editor and roster picker galleries: a singles
 * match with a planned winner, a tag match for a title and a talking segment, plus the answers a
 * stand-in engine gives for `match.catalog`, `match.slotRoles` and `booking.availableWorkers`.
 * Nothing here is a length or a time (D-10).
 */
import {
  parseContentKey,
  parseGameDate,
  parseId,
  PUSH_LABELS,
  STYLE_LABELS,
} from '@ringside/engine';
import type {
  AvailableTeamRow,
  AvailableWorkerRow,
  AvailableWorkersView,
  AvailabilityStatus,
  RingStyle,
  BookingCard,
  BookingPersonView,
  BookingSegmentView,
  BookingTitleOption,
  DurationClass,
  MatchCatalog,
  PersonId,
  SegmentDraft,
  SlotRoleRow,
  SlotRolesArgs,
} from '@ringside/engine';
import type { RosterPickerPerson, RosterPickerTeam } from '@/components/RosterPicker';
import { galleryCard } from './booking';

const SHOW_DATE = parseGameDate('2027-02-04');
const NO_CREW = { refereeId: null, producerId: null, announcerIds: [] };

interface Worker {
  readonly name: string;
  readonly status: AvailabilityStatus;
  readonly label: string;
  readonly reason: string;
  readonly canWorkAngles: boolean;
  readonly brandName: string | null;
  readonly onCard: string | null;
}

/** Each worker's ring style, popularity in the show's region and stamina, by index. */
const WORKER_STATS: readonly { style: RingStyle; popularity: number; stamina: number }[] = [
  { style: 'highFlyer', popularity: 54.4, stamina: 72.2 },
  { style: 'powerhouse', popularity: 61, stamina: 58 },
  { style: 'technician', popularity: 78.6, stamina: 81 },
  { style: 'striker', popularity: 33, stamina: 66 },
  { style: 'brawler', popularity: 47, stamina: 70 },
  { style: 'hardcore', popularity: 22, stamina: 64 },
  { style: 'allRounder', popularity: 40, stamina: 75 },
  { style: 'showman', popularity: 0, stamina: 55 },
  { style: 'technician', popularity: 31, stamina: 60 },
];

/** The region the gallery's show is in. */
export const GALLERY_REGION_NAME = 'Greater Lakes';

const AVAILABLE = { status: 'available', label: 'Available', reason: 'Available' } as const;

const WORKERS: readonly Worker[] = [
  { name: 'Kai Moreno', ...AVAILABLE, canWorkAngles: true, brandName: null, onCard: null },
  { name: 'Rex Hale', ...AVAILABLE, canWorkAngles: true, brandName: null, onCard: null },
  { name: 'Rhea Cortez', ...AVAILABLE, canWorkAngles: true, brandName: null, onCard: null },
  { name: 'Jo Park', ...AVAILABLE, canWorkAngles: true, brandName: null, onCard: null },
  {
    name: 'Tia Cruz',
    status: 'injured',
    label: 'Injured until 12 Feb',
    reason: 'Injured (leg injury) until 12 Feb; can still do talking segments',
    canWorkAngles: true,
    brandName: null,
    onCard: null,
  },
  {
    name: 'Dax Romero',
    status: 'suspended',
    label: 'Suspended',
    reason: 'Suspended by the promotion until 20 Feb',
    canWorkAngles: false,
    brandName: null,
    onCard: null,
  },
  {
    name: 'Mara Voss',
    ...AVAILABLE,
    canWorkAngles: true,
    brandName: 'Altura Overclock',
    onCard: null,
  },
  { name: 'Sam Reed', ...AVAILABLE, canWorkAngles: true, brandName: null, onCard: 'Opener' },
  // A long name, so the phone layout is checked against one (EVT2-10).
  {
    name: 'Maximilian Vandersteenhoven-Kaczmarczyk',
    ...AVAILABLE,
    canWorkAngles: true,
    brandName: null,
    onCard: null,
  },
];

/** Genders by index, with someone non-binary, so the picker's Gender filter has all three. */
const GENDERS_BY_INDEX = [
  'male',
  'male',
  'female',
  'male',
  'female',
  'male',
  'female',
  'male',
  'nonBinary',
] as const;

function personId(index: number): PersonId {
  return parseId('person', `per_${String(index + 101).padStart(10, '0')}`);
}

const TEAM_ID = parseId('team', 'tem_0000000101');
const TAG_TITLE_ID = parseId('title', 'tit_0000000101');
const WORLD_TITLE_ID = parseId('title', 'tit_0000000102');

/** The roster as `booking.availableWorkers` lists it for a match. */
export function galleryWorkerRows(kind: 'match' | 'angle'): AvailableWorkerRow[] {
  return WORKERS.map((worker, index) => ({
    personId: personId(index),
    ringName: worker.name,
    imageRef: 'placeholder:person',
    gender: GENDERS_BY_INDEX[index] ?? 'male',
    roles: ['wrestler'],
    employmentRole: 'wrestler',
    push:
      index === 2 ? 'mainEvent' : index < 2 ? 'upperCard' : index === 8 ? 'lowerCard' : 'midCard',
    alignment: index % 2 === 0 ? 'face' : 'heel',
    brandId: null,
    brandName: worker.brandName,
    otherBrand: worker.brandName !== null,
    availability: {
      status: worker.status,
      label: worker.label,
      reason: worker.reason,
      until: null,
      canWorkAngles: worker.canWorkAngles,
    },
    bookable: kind === 'match' ? worker.status === 'available' : worker.canWorkAngles,
    onCard:
      worker.onCard === null
        ? []
        : [{ segmentId: parseId('segment', 'seg_0000000901'), slotLabel: 'Slot 1' }],
    appearancesThisYear: 4,
    appearanceCap: null,
    style: WORKER_STATS[index]?.style ?? 'allRounder',
    popularity: WORKER_STATS[index]?.popularity ?? 0,
    stamina: WORKER_STATS[index]?.stamina ?? 50,
  }));
}

const TEAM: AvailableTeamRow = {
  teamId: TEAM_ID,
  name: 'The Hale Storm',
  kind: 'tag',
  memberIds: [personId(0), personId(1)],
  bookable: true,
};

/** `booking.availableWorkers`, searched by ring name. */
export function galleryAvailableWorkers(
  kind: 'match' | 'angle',
  search: string | undefined,
): AvailableWorkersView {
  const needle = (search ?? '').trim().toLowerCase();
  const people = galleryWorkerRows(kind).filter((row) =>
    row.ringName.toLowerCase().includes(needle),
  );
  return {
    region: { regionId: parseId('region', 'reg_0000000101'), name: GALLERY_REGION_NAME },
    people,
    teams: needle === '' || TEAM.name.toLowerCase().includes(needle) ? [TEAM] : [],
  };
}

/** The picker's rows straight from the roster, for the RosterPicker gallery. */
export function galleryPickerPeople(): RosterPickerPerson[] {
  return galleryWorkerRows('match').map((row, index) => ({
    personId: row.personId,
    name: row.ringName,
    imageRef: row.imageRef,
    pushLabel: PUSH_LABELS[row.push],
    push: row.push,
    gender: row.gender,
    alignment: row.alignment,
    availability: { status: row.availability.status, label: row.availability.label },
    selectable: row.bookable,
    reason: row.bookable ? null : `Can't wrestle on this date: ${row.availability.reason}`,
    otherBrand: row.otherBrand,
    bookedElsewhere: row.onCard.length > 0,
    notes: [
      ...(row.brandName === null ? [] : [`Other brand: ${row.brandName}`]),
      ...(WORKERS[index]?.onCard === null ? [] : [`On this card: ${WORKERS[index]?.onCard ?? ''}`]),
    ],
    typeLabel: STYLE_LABELS[row.style],
    stats: [
      {
        key: 'popularity',
        short: 'Pop',
        label: `Popularity in ${GALLERY_REGION_NAME}`,
        value: Math.round(row.popularity),
      },
      { key: 'stamina', short: 'Stamina', label: 'Stamina', value: Math.round(row.stamina) },
    ],
  }));
}

export const GALLERY_PICKER_TEAMS: readonly RosterPickerTeam[] = [
  {
    teamId: TEAM_ID,
    name: 'The Hale Storm',
    memberNames: ['Kai Moreno', 'Rex Hale'],
    memberGenders: ['male', 'male'],
    memberPushes: ['upperCard', 'upperCard'],
    selectable: true,
    reason: null,
    otherBrand: false,
  },
  {
    teamId: parseId('team', 'tem_0000000102'),
    name: 'Cruz Control',
    memberNames: ['Tia Cruz', 'Jo Park'],
    memberGenders: ['female', 'male'],
    memberPushes: ['midCard', 'midCard'],
    selectable: false,
    reason: 'Not everyone can be booked: Tia Cruz: Injured until 12 Feb',
    otherBrand: false,
  },
];

const SIMPLE = { min: 1, max: 1 };

export const GALLERY_CATALOG: MatchCatalog = {
  available: true,
  matchTypes: [
    {
      key: parseContentKey('match.singles'),
      name: 'Singles',
      shortName: 'Singles',
      order: 10,
      sides: { min: 2, max: 2 },
      sideSize: SIMPLE,
      equalSides: true,
      durationShift: 0,
      allowsTitles: true,
      hidden: false,
    },
    {
      key: parseContentKey('match.tag-team'),
      name: 'Tag Team',
      shortName: 'Tag',
      order: 20,
      sides: { min: 2, max: 2 },
      sideSize: { min: 2, max: 2 },
      equalSides: true,
      durationShift: 0,
      allowsTitles: true,
      hidden: false,
    },
    {
      key: parseContentKey('match.triple-threat'),
      name: 'Three-Way',
      shortName: 'Three-Way',
      order: 40,
      sides: { min: 3, max: 3 },
      sideSize: SIMPLE,
      equalSides: true,
      durationShift: 0,
      allowsTitles: true,
      hidden: false,
    },
    {
      key: parseContentKey('match.fatal-four-way'),
      name: 'Four-Way',
      shortName: 'Four-Way',
      order: 50,
      sides: { min: 4, max: 4 },
      sideSize: SIMPLE,
      equalSides: true,
      durationShift: 0,
      allowsTitles: true,
      hidden: false,
    },
    {
      key: parseContentKey('match.battle-royal'),
      name: 'Battle Royal',
      shortName: 'Royal',
      order: 70,
      sides: { min: 6, max: 30 },
      sideSize: SIMPLE,
      equalSides: true,
      durationShift: 1,
      allowsTitles: false,
      hidden: false,
    },
    {
      key: parseContentKey('match.sprint'),
      name: 'Sprint',
      shortName: 'Sprint',
      order: 90,
      sides: { min: 2, max: 2 },
      sideSize: SIMPLE,
      equalSides: true,
      durationShift: -1,
      allowsTitles: true,
      hidden: false,
    },
  ],
  angleTypes: [
    {
      key: parseContentKey('angle.promo'),
      name: 'Promo',
      shortName: 'Promo',
      order: 10,
      speakers: { min: 1, max: 4 },
      beatKeys: [parseContentKey('beat.promo')],
      defaultBeatKey: parseContentKey('beat.promo'),
      settings: ['ring', 'backstage', 'video'],
      hidden: false,
    },
    {
      key: parseContentKey('angle.confrontation'),
      name: 'Confrontation',
      shortName: 'Confrontation',
      order: 30,
      speakers: { min: 2, max: 8 },
      beatKeys: [parseContentKey('beat.staredown')],
      defaultBeatKey: parseContentKey('beat.staredown'),
      settings: ['ring', 'backstage'],
      hidden: false,
    },
  ],
  methods: [
    {
      key: parseContentKey('method.pinfall'),
      name: 'Pinfall',
      order: 10,
      changesTitles: true,
      hidden: false,
    },
    {
      key: parseContentKey('method.submission'),
      name: 'Submission',
      order: 20,
      changesTitles: true,
      hidden: false,
    },
    {
      key: parseContentKey('method.count-out'),
      name: 'Count-Out',
      order: 50,
      changesTitles: false,
      hidden: false,
    },
    {
      key: parseContentKey('method.disqualification'),
      name: 'Disqualification',
      order: 60,
      changesTitles: false,
      hidden: false,
    },
  ],
  beats: [],
  angleTemplates: [],
};

const CLASS_LABELS: Readonly<Record<DurationClass, string>> = {
  short: 'Short',
  standard: 'Standard',
  long: 'Long',
};
const CLASSES: readonly DurationClass[] = ['short', 'standard', 'long'];

/** `match.slotRoles` for the gallery card: the opener short, the main event long, a type's shift on top. */
export function gallerySlotRoles(args: SlotRolesArgs): SlotRoleRow[] {
  const rows: SlotRoleRow[] = [];
  const total = args.preShowSlots + args.slots;
  for (let place = 0; place < total; place += 1) {
    const preShow = place < args.preShowSlots;
    const slot = preShow ? place + 1 : place - args.preShowSlots + 1;
    const role = preShow
      ? 'preShow'
      : slot === 1
        ? 'opener'
        : slot === args.slots
          ? 'mainEvent'
          : slot === args.slots - 1
            ? 'semiMain'
            : 'midcard';
    const base = role === 'mainEvent' ? 2 : role === 'opener' || role === 'preShow' ? 0 : 1;
    const key = args.matchTypeKeys?.[place] ?? null;
    const shift = GALLERY_CATALOG.matchTypes.find((type) => type.key === key)?.durationShift ?? 0;
    const durationClass = CLASSES[Math.min(Math.max(base + shift, 0), 2)] ?? 'standard';
    const trace = { kind: 'input' as const, label: 'Slot', value: slot };
    rows.push({
      slot,
      preShow,
      role,
      roleLabel: role,
      durationClass,
      durationLabel: CLASS_LABELS[durationClass],
      weight: 1,
      roleTrace: trace,
      durationTrace: trace,
      weightTrace: trace,
    });
  }
  return rows;
}

function viewPerson(index: number, role: 'competitor' | 'speaker'): BookingPersonView {
  const worker = WORKERS[index];
  return {
    personId: personId(index),
    ringName: worker?.name ?? 'Someone',
    imageRef: 'placeholder:person',
    role,
    talkRole: role === 'speaker' ? 'wrestler' : null,
    availability: {
      status: worker?.status ?? 'available',
      label: worker?.label ?? 'Available',
      reason: worker?.reason ?? 'Available',
      until: null,
      canWorkAngles: worker?.canWorkAngles ?? true,
    },
    otherBrand: worker?.brandName !== null,
  };
}

function base() {
  return { label: null, storylineIds: [], crew: NO_CREW };
}

const SINGLES_DRAFT: SegmentDraft = {
  kind: 'match',
  ...base(),
  participants: [
    { personId: personId(2), side: 0, role: 'competitor', teamId: null },
    { personId: personId(3), side: 1, role: 'competitor', teamId: null },
  ],
  match: {
    matchTypeKey: parseContentKey('match.singles'),
    stipulationKeys: [],
    titleIds: [],
    finishKey: null,
  },
  outcome: { kind: 'win', winningSide: 0, methodKey: parseContentKey('method.pinfall') },
};

const TAG_DRAFT: SegmentDraft = {
  kind: 'match',
  ...base(),
  label: 'For the tag team titles',
  participants: [
    { personId: personId(0), side: 0, role: 'competitor', teamId: TEAM_ID },
    { personId: personId(1), side: 0, role: 'competitor', teamId: TEAM_ID },
    { personId: personId(6), side: 1, role: 'competitor', teamId: null },
  ],
  match: {
    matchTypeKey: parseContentKey('match.tag-team'),
    stipulationKeys: [],
    titleIds: [TAG_TITLE_ID],
    finishKey: null,
  },
  outcome: null,
};

const PROMO_DRAFT: SegmentDraft = {
  kind: 'angle',
  ...base(),
  participants: [{ personId: personId(4), side: 0, role: 'speaker', teamId: null }],
  angle: { angleTypeKey: parseContentKey('angle.promo') },
};

function segment(
  serial: number,
  typeName: string,
  draft: SegmentDraft,
  sides: BookingSegmentView['sides'],
): BookingSegmentView {
  return {
    segmentId: parseId('segment', `seg_${String(900 + serial).padStart(10, '0')}`),
    kind: draft.kind,
    label: draft.label,
    typeKey: draft.kind === 'match' ? draft.match.matchTypeKey : draft.angle.angleTypeKey,
    typeName,
    durationShiftNote: null,
    titles: [],
    sides,
    result: null,
    storylineIds: [],
    finishKey: null,
    stipulationKeys: [],
    draft,
    setting: draft.kind === 'angle' ? (draft.angle.setting ?? 'ring') : 'ring',
    talkLine: null,
  };
}

export const GALLERY_SINGLES = segment(2, 'Singles', SINGLES_DRAFT, [
  { side: 0, name: 'Rhea Cortez', teamId: null, people: [viewPerson(2, 'competitor')] },
  { side: 1, name: 'Jo Park', teamId: null, people: [viewPerson(3, 'competitor')] },
]);

export const GALLERY_TAG = segment(3, 'Tag Team', TAG_DRAFT, [
  {
    side: 0,
    name: 'The Hale Storm',
    teamId: TEAM_ID,
    people: [viewPerson(0, 'competitor'), viewPerson(1, 'competitor')],
  },
  { side: 1, name: 'Mara Voss', teamId: null, people: [viewPerson(6, 'competitor')] },
]);

export const GALLERY_PROMO = segment(4, 'Promo', PROMO_DRAFT, [
  { side: 0, name: 'Tia Cruz', teamId: null, people: [viewPerson(4, 'speaker')] },
]);

const TITLE_OPTIONS: BookingTitleOption[] = [
  {
    titleId: WORLD_TITLE_ID,
    name: 'Coastal Crown Championship',
    holderCount: 1,
    brandId: null,
    otherBrand: false,
    imageRef: 'placeholder:title',
    holderIds: [personId(2)],
    holderNames: ['Rhea Cortez'],
    vacant: false,
  },
  {
    titleId: TAG_TITLE_ID,
    name: 'Altura Tag Team Championship',
    holderCount: 2,
    brandId: parseId('brand', 'brd_0000000101'),
    otherBrand: true,
    imageRef: 'placeholder:title',
    holderIds: [],
    holderNames: [],
    vacant: true,
  },
];

/** The gallery's card: the singles opener-to-be in slot 2, the tag match in 3, the promo in 4. */
export const GALLERY_EDITOR_CARD: BookingCard = {
  show: {
    eventInstanceId: parseId('eventInstance', 'evi_0000000101'),
    name: 'Altura Mainstage',
    date: SHOW_DATE,
    airDate: SHOW_DATE,
    importance: 'regular',
    promotionId: parseId('promotion', 'pro_0000000101'),
    brandId: null,
    brandName: null,
    status: 'scheduled',
    isToday: false,
    daysUntil: 3,
    format: { slots: 6, preShowSlots: 1 },
  },
  canEdit: true,
  editBlock: null,
  runsTonight: false,
  randomWinners: false,
  sections: galleryCard([null, GALLERY_SINGLES, GALLERY_TAG, GALLERY_PROMO, null, null]),
  titleOptions: TITLE_OPTIONS,
};
