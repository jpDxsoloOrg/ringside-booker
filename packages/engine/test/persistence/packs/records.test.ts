import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_KEYS } from '../../../src/model/entities/person';
import {
  describePackIssues,
  packManifestSchema,
  RECORD_KINDS,
  recordFileSchema,
  recordKinds,
  recordSchemas,
  refSchema,
  type RecordKind,
} from '../../../src/persistence/packs';
import { parseIssues } from '../../support/schema-issues';
import { readExamplePack } from '../../support/pack-example';

type Fixture = Record<string, unknown>;

const ATTRIBUTES = Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, 50]));
const ATTRIBUTE_DISTRIBUTIONS = Object.fromEntries(
  ATTRIBUTE_KEYS.map((key) => [key, { mean: 50, sd: 12, talentWeight: 0.6 }]),
);

const VALID_PRODUCTION: Fixture = {
  stage: 3,
  camera: 3,
  editing: 2,
  pyro: 1,
  music: 2,
  writing: 3,
  marketing: 2,
  backOffice: 3,
};

const VALID_TERMS: Fixture = {
  kind: 'written',
  exclusive: true,
  monthlyWage: 2500,
  perAppearanceFee: 0,
  signingBonus: 1000,
  shares: { gateBp: 0, merchBp: 500, broadcastBp: 0 },
  appearanceCap: null,
  perks: { creativeControl: false, noHouseShows: false, ironClad: false, travelCovered: true },
};

/** One valid record of every kind. */
const VALID_RECORDS: Readonly<Record<RecordKind, Fixture>> = {
  continent: { key: 'arden', name: 'Arden', code: 'ARD' },
  country: {
    key: 'cormere',
    name: 'Cormere',
    code: 'CRM',
    continentKey: 'arden',
    population: 8_200_000,
    wrestlingInterest: 62,
    economy: 55,
    preferredStyle: null,
  },
  region: {
    key: 'harbour-coast',
    name: 'Harbour Coast',
    countryKey: 'cormere',
    population: 1_900_000,
    wrestlingInterest: 70,
    preferredStyle: 'hardHitting',
    neighbourKeys: ['north-hills', 'base-world:river-lands'],
  },
  nameCulture: {
    key: 'cormeran',
    label: 'Cormeran',
    given: {
      male: [
        ['Jack', 10],
        ['Tomas', 4],
      ],
      female: [['Mira', 8]],
      neutral: [],
    },
    surnames: [
      ['Marlow', 5],
      ['Vale', 3],
    ],
    surnameStyle: 'single',
  },
  countryNameMix: {
    key: 'cormere',
    countryKey: 'cormere',
    cultures: [
      { cultureKey: 'cormeran', weight: 80 },
      { cultureKey: 'base-names:northern', weight: 20 },
    ],
  },
  ringNameWords: {
    key: 'default-words',
    adjectives: ['Iron', 'Silent'],
    nouns: ['Storm', 'Anchor'],
    nicknames: ['The Hammer'],
    patterns: [
      ['{adjective} {noun}', 30],
      ['"{nickname}" {family}', 5],
    ],
  },
  generationRole: {
    key: 'wrestler',
    label: 'Wrestler',
    role: 'wrestler',
    performer: true,
    genderShares: { male: 0.68, female: 0.3, nonBinary: 0.02 },
    stageShares: { rookie: 0.2, prospect: 0.24, established: 0.3, veteran: 0.18, legend: 0.08 },
    stageAges: {
      rookie: { min: 18, max: 24 },
      prospect: { min: 21, max: 28 },
      established: { min: 26, max: 36 },
      veteran: { min: 33, max: 45 },
      legend: { min: 40, max: 58 },
    },
    roleSkills: [],
    performerAttributes: ['ringwork', 'psychology', 'mic', 'charisma'],
    debut: { ageSd: 2.2, minAge: 17, maxAge: 30 },
    motivationWeights: { money: 30, legacy: 25, power: 8, enjoyment: 25, thrill: 12 },
  },
  generationStyle: {
    key: 'high-flyer',
    style: 'highFlyer',
    weight: 11,
    promotionStyles: ['highFlying'],
    attributeModifiers: { athleticism: 8, safety: -4 },
    wearMultiplier: 1.15,
    maskedChance: 0.3,
  },
  bodyArchetype: {
    key: 'compact-flyer',
    label: 'Compact flyer',
    build: 'slim',
    heightCm: { min: 160, max: 175 },
    weightKg: { min: 60, max: 80 },
    scale: {
      female: { heightCm: 0.93, weightKg: 0.8 },
      nonBinary: { heightCm: 0.96, weightKg: 0.88 },
    },
    styleWeights: {
      allRounder: 2,
      technician: 2,
      brawler: 0,
      highFlyer: 10,
      powerhouse: 0,
      hardcore: 1,
      striker: 2,
      grappler: 1,
      showman: 2,
      nonWrestler: 1,
    },
  },
  bodyModifier: {
    key: 'heavy-stamina',
    label: 'Heavier wrestlers tire sooner',
    attribute: 'stamina',
    measure: 'weightKg',
    direction: 'above',
    from: 110,
    perUnit: -0.25,
    limit: 20,
  },
  generationProfile: {
    key: 'wrestler-established',
    label: 'Wrestler, established',
    role: 'wrestler',
    stage: 'established',
    attributes: ATTRIBUTE_DISTRIBUTIONS,
  },
  traitIncidence: {
    key: 'fast-learner',
    traitKey: 'fastLearner',
    baseChance: 0.08,
    roleMultipliers: { wrestler: 1.5, referee: 0 },
    minAge: 16,
  },
  person: {
    key: 'jack-marlow',
    givenName: 'Jack',
    familyName: 'Marlow',
    defaultRingName: 'Jack Marlow',
    gender: 'male',
    birthDate: '1996-04-12',
    debutDate: '2016-09-03',
    birthRegionKey: 'harbour-coast',
    basedInRegionKey: 'harbour-coast',
    roles: ['wrestler'],
    motivation: 'legacy',
    heightCm: 185,
    weightKg: 102,
    build: 'athletic',
    style: 'technician',
    attributes: ATTRIBUTES,
    condition: { head: 100, neck: 95, back: 90, arms: 100, torso: 100, legs: 92 },
    development: { potential: 250, ceilings: { ringwork: 85 } },
    regionalPop: { 'harbour-coast': 34 },
    traits: ['workhorse'],
    vices: { alcohol: 'none', substances: 'none' },
  },
  promotion: {
    key: 'harbour-city-wrestling',
    name: 'Harbour City Wrestling',
    shortName: 'HCW',
    logoRef: null,
    foundedOn: '2012-05-19',
    status: 'active',
    homeRegionKey: 'harbour-coast',
    regionalPop: { 'harbour-coast': 41 },
    prestige: 38,
    cash: -1500,
    style: 'traditional',
    ownerPersonKey: 'jack-marlow',
    bookerPersonKey: null,
    parentPromotionKey: null,
    production: VALID_PRODUCTION,
    policies: { catering: 1, travel: 1, medical: 2 },
    color: '#1f6f8b',
  },
  brand: {
    key: 'hcw-tide',
    promotionKey: 'harbour-city-wrestling',
    name: 'Tide',
    priority: 0,
    active: true,
  },
  title: {
    key: 'hcw-heavyweight',
    promotionKey: 'harbour-city-wrestling',
    brandKey: 'hcw-tide',
    name: 'HCW Heavyweight Championship',
    holderCount: 1,
    division: { gender: 'open', minWeightKg: 90, maxWeightKg: null },
    prestige: 60,
    status: 'active',
    introducedOn: '2013-01-01',
    color: '#c9a227',
  },
  venue: {
    key: 'pier-hall',
    regionKey: 'harbour-coast',
    name: 'Pier Hall',
    capacity: 1800,
    kind: 'hall',
    exclusivePromotionKey: 'harbour-city-wrestling',
  },
  network: {
    key: 'coast-tv',
    name: 'Coast TV',
    kind: 'tv',
    reachTier: 2,
    coverage: { continentKeys: [], countryKeys: ['cormere'], regionKeys: [] },
    ownerPromotionKey: null,
    launchedOn: '1998-03-01',
  },
  eventDefinition: {
    key: 'hcw-tidal-wave',
    promotionKey: 'harbour-city-wrestling',
    brandKey: 'hcw-tide',
    name: 'Tidal Wave',
    importance: 'regular',
    recurrence: { kind: 'everyNWeeks', intervalWeeks: 2, weekday: 0, anchor: '2026-01-05' },
    format: { slots: 6, preShowSlots: 0 },
    televised: true,
    preferredVenueKey: 'pier-hall',
    preferredRegionKey: 'harbour-coast',
    activeFrom: '2026-01-05',
  },
  deal: {
    key: 'hcw-coast-tv',
    promotionKey: 'harbour-city-wrestling',
    networkKey: 'coast-tv',
    eventDefinitionKey: 'hcw-tidal-wave',
    startsOn: '2025-07-01',
    endsOn: '2027-07-01',
    timeslot: 'evening',
    weekday: 0,
    live: false,
    terms: { feePerShow: 12_000, perThousandViewers: 15, costPerShow: 2_000 },
  },
  employment: {
    key: 'jack-marlow-hcw',
    personKey: 'jack-marlow',
    promotionKey: 'harbour-city-wrestling',
    brandKey: 'hcw-tide',
    role: 'wrestler',
    ringName: 'Jack Marlow',
    gimmickKey: 'gimmick.lunch-pail',
    alignment: 'face',
    push: 'upperCard',
    terms: VALID_TERMS,
    startsOn: '2025-03-01',
    endsOn: null,
  },
  team: {
    key: 'tide-breakers',
    kind: 'tag',
    name: 'The Tide Breakers',
    memberKeys: ['jack-marlow', 'tomas-vale'],
    formedOn: '2024-06-01',
    experience: 40,
  },
  titleReign: {
    key: 'hcw-heavyweight-1',
    titleKey: 'hcw-heavyweight',
    holderPersonKeys: ['jack-marlow'],
    wonOn: '2025-05-10',
    lostOn: null,
    endReason: null,
    defences: 3,
  },
  matchType: {
    key: 'singles',
    name: 'Singles',
    order: 10,
    sides: { min: 2, max: 2 },
    sideSize: { min: 1, max: 1 },
    durationShift: 0,
    styleAffinity: [],
  },
  angleType: {
    key: 'promo',
    name: 'Promo',
    order: 10,
    defaultBeatKey: 'beat.promo',
    speakers: { min: 1, max: 4 },
    speakerWeights: { mic: 0.6, charisma: 0.3, presence: 0.1 },
  },
  method: {
    key: 'pinfall',
    name: 'Pinfall',
    order: 10,
    changesTitles: true,
  },
  finish: {
    key: 'clean',
    name: 'Clean finish',
    order: 10,
    summary: 'One side beats the other fair and square.',
    category: 'clean',
    outcomeKind: 'win',
    methods: [{ methodKey: 'pinfall', weight: 1 }],
    effects: { workRate: 0, crowd: 1 },
    allowsTitleChange: true,
    gains: { winner: 1, loser: 1 },
    autoWeight: 60,
    requiresTwoSides: false,
  },
  beat: {
    key: 'promo',
    name: 'Promo',
    description: 'Someone talks.',
    groups: [
      {
        label: 'Speaker',
        stats: ['mic', 'charisma'],
        weight: 1,
        minPeople: 1,
        maxPeople: 4,
        optional: false,
        managerCanStandIn: true,
      },
    ],
    physical: false,
    repetitionGroup: 'talk',
    weight: 1,
  },
  angleTemplate: {
    key: 'solo-promo',
    name: 'Solo Promo',
    angleTypeKey: 'promo',
    purpose: 'promo',
    beats: [{ beatKey: 'promo', groupOne: 'a', groupTwo: null, optional: false }],
  },
  injuryKind: {
    key: 'sprained-ankle',
    label: 'Sprained ankle',
    bodyPart: 'legs',
    minDays: 5,
    maxDays: 28,
    weight: 10,
    canWorkAnglesChance: 0.8,
    severityWeights: { minor: 60, moderate: 30, severe: 10 },
  },
};

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function record(kind: RecordKind, overrides: Fixture = {}): Fixture {
  return { ...VALID_RECORDS[kind], ...overrides };
}

function withoutField(fixture: Fixture, field: string): Fixture {
  return Object.fromEntries(Object.entries(fixture).filter(([name]) => name !== field));
}

describe('record schemas', () => {
  it('cover every record kind', () => {
    expect(Object.keys(recordSchemas).sort()).toEqual([...RECORD_KINDS].sort());
    expect(Object.keys(recordKinds).sort()).toEqual([...RECORD_KINDS].sort());
  });

  it.each(RECORD_KINDS)('parse a valid %s record', (kind) => {
    expect(parseIssues(recordSchemas[kind], VALID_RECORDS[kind])).toEqual([]);
  });

  it.each(RECORD_KINDS)('reject an unknown field on a %s record', (kind) => {
    expect(parseIssues(recordSchemas[kind], record(kind, { notAField: 1 }))).toEqual([
      ': Unrecognized key: "notAField"',
    ]);
  });

  it.each(RECORD_KINDS)('accept a patch and a removal of a %s record', (kind) => {
    const fields = Object.keys(VALID_RECORDS[kind]).filter((field) => field !== 'key');
    const [firstField] = fields;
    expect(firstField).toBeDefined();
    const patch = {
      key: VALID_RECORDS[kind]['key'],
      $override: 'patch',
      [String(firstField)]: VALID_RECORDS[kind][String(firstField)],
    };
    expect(parseIssues(recordSchemas[kind], patch)).toEqual([]);
    expect(parseIssues(recordSchemas[kind], { key: 'gone', $remove: true })).toEqual([]);
  });

  it('rejects a region with wrestlingInterest 101', () => {
    expect(parseIssues(recordSchemas.region, record('region', { wrestlingInterest: 101 }))).toEqual(
      ['wrestlingInterest: Too big: expected number to be <=100'],
    );
  });

  it('lets a region leave out interest and style to inherit the country values', () => {
    const region = withoutField(
      withoutField(record('region'), 'wrestlingInterest'),
      'preferredStyle',
    );
    expect(parseIssues(recordSchemas.region, region)).toEqual([]);
  });

  it('rejects a region that lists itself as a neighbour', () => {
    const region = record('region', { neighbourKeys: ['example-world:harbour-coast'] });
    expect(parseIssues(recordSchemas.region, region)).toEqual([
      'neighbourKeys.0: A region cannot be its own neighbour',
    ]);
  });

  it('rejects NaN and Infinity in number fields', () => {
    expect(
      recordSchemas.country.safeParse(record('country', { economy: Number.NaN })).success,
    ).toBe(false);
    expect(
      recordSchemas.traitIncidence.safeParse(
        record('traitIncidence', { roleMultipliers: { wrestler: Number.POSITIVE_INFINITY } }),
      ).success,
    ).toBe(false);
  });

  it('rejects dates that are not ISO YYYY-MM-DD', () => {
    for (const date of ['2012-5-19', '19/05/2012', '2012-02-30', '1899-12-31']) {
      expect(
        recordSchemas.promotion.safeParse(record('promotion', { foundedOn: date })).success,
      ).toBe(false);
    }
  });
});

describe('references', () => {
  it('accept a bare key and a pack-qualified key', () => {
    expect(refSchema.safeParse('harbour-coast').success).toBe(true);
    expect(refSchema.safeParse('base-world:harbour-coast').success).toBe(true);
  });

  it('reject a display name, an empty value and a malformed qualifier', () => {
    for (const ref of ['Harbour Coast', 'harbour coast', '', 'Base:harbour', ':harbour', 'a:b:c']) {
      expect(refSchema.safeParse(ref).success).toBe(false);
    }
  });

  it('names the field path when a record refers to a display name', () => {
    const promotion = record('promotion', { homeRegionKey: 'Harbour Coast' });
    const result = recordSchemas.promotion.safeParse(promotion);
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    const lines = describePackIssues('promotions.json[0]', result.error);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^promotions\.json\[0\]\.homeRegionKey: Expected a reference/);
  });

  it('name the path inside lists and sparse maps too', () => {
    const region = record('region', { neighbourKeys: ['north-hills', 'River Lands'] });
    expect(parseIssues(recordSchemas.region, region)[0]).toMatch(
      /^neighbourKeys\.1: Expected a reference/,
    );
    const person = record('person', { regionalPop: { 'Harbour Coast': 30 } });
    expect(parseIssues(recordSchemas.person, person)[0]).toMatch(/^regionalPop\.Harbour Coast: /);
  });

  it('reject a repeated reference in a list', () => {
    const team = record('team', { memberKeys: ['jack-marlow', 'jack-marlow'] });
    expect(parseIssues(recordSchemas.team, team)).toContain(
      'memberKeys.1: Duplicate reference jack-marlow',
    );
  });

  it('treat a bare key and the same key qualified with a pack as a repeat', () => {
    const team = record('team', { memberKeys: ['jack-marlow', 'example-world:jack-marlow'] });
    expect(parseIssues(recordSchemas.team, team)).toContain(
      'memberKeys.1: Duplicate reference example-world:jack-marlow',
    );
  });

  it('reject a key with capitals or spaces', () => {
    expect(recordSchemas.continent.safeParse(record('continent', { key: 'Arden' })).success).toBe(
      false,
    );
    expect(
      recordSchemas.continent.safeParse(record('continent', { key: 'arden north' })).success,
    ).toBe(false);
    expect(
      recordSchemas.continent.safeParse(record('continent', { key: 'base:arden' })).success,
    ).toBe(false);
  });
});

describe('people', () => {
  it('rejects an attribute key that is not in the engine attribute list', () => {
    const person = record('person', { attributes: { ...ATTRIBUTES, wrestlingSkill: 60 } });
    expect(parseIssues(recordSchemas.person, person)).toEqual([
      'attributes: Unrecognized key: "wrestlingSkill"',
    ]);
  });

  it('rejects a person missing an attribute', () => {
    const attributes = Object.fromEntries(
      Object.entries(ATTRIBUTES).filter(([key]) => key !== 'mic'),
    );
    expect(recordSchemas.person.safeParse(record('person', { attributes })).success).toBe(false);
  });

  it('rejects transient state, which the loader fills in', () => {
    for (const field of ['fatigue', 'injury', 'restrictions', 'id']) {
      expect(parseIssues(recordSchemas.person, record('person', { [field]: 0 }))).toEqual([
        `: Unrecognized key: "${field}"`,
      ]);
    }
  });

  it('rejects a debut before age 14 and a style that needs a wrestling role', () => {
    expect(
      parseIssues(recordSchemas.person, record('person', { debutDate: '2005-01-01' })),
    ).toEqual(['debutDate: debutDate must be at least 14 years after birthDate']);
    expect(parseIssues(recordSchemas.person, record('person', { roles: ['referee'] }))).toEqual([
      'roles: A person with ring style technician needs the wrestler or occasionalWrestler role',
    ]);
  });

  it('rejects an exclusive trait pair', () => {
    const person = record('person', { traits: ['workhorse', 'coaster'] });
    expect(recordSchemas.person.safeParse(person).success).toBe(false);
  });

  it('rejects an employment with a status, a per-appearance wage or bad dates', () => {
    expect(
      parseIssues(recordSchemas.employment, record('employment', { status: 'active' })),
    ).toEqual([': Unrecognized key: "status"']);
    const terms = { ...VALID_TERMS, kind: 'perAppearance' };
    expect(parseIssues(recordSchemas.employment, record('employment', { terms }))).toEqual([
      'terms.monthlyWage: A per-appearance contract has no monthly wage',
    ]);
    expect(
      parseIssues(recordSchemas.employment, record('employment', { endsOn: '2025-03-01' })),
    ).toEqual(['endsOn: endsOn must be after startsOn (or null for open-ended)']);
  });

  it('rejects an employment managed by its own person, qualified or not', () => {
    for (const managerPersonKey of ['jack-marlow', 'example-world:jack-marlow']) {
      expect(
        parseIssues(recordSchemas.employment, record('employment', { managerPersonKey })),
      ).toEqual(['managerPersonKey: A person cannot be their own manager']);
    }
    expect(
      parseIssues(recordSchemas.employment, record('employment', { managerPersonKey: null })),
    ).toEqual([]);
  });

  it('rejects fractional and negative money', () => {
    for (const monthlyWage of [2500.5, -1]) {
      const terms = { ...VALID_TERMS, monthlyWage };
      expect(recordSchemas.employment.safeParse(record('employment', { terms })).success).toBe(
        false,
      );
    }
  });

  it('rejects a tag team with three members and a reign with no end reason', () => {
    const team = record('team', { memberKeys: ['a-one', 'a-two', 'a-three'] });
    expect(parseIssues(recordSchemas.team, team)).toEqual([
      'memberKeys: A tag team has exactly 2 members',
    ]);
    const reign = record('titleReign', { lostOn: '2025-09-01' });
    expect(parseIssues(recordSchemas.titleReign, reign)).toEqual([
      'endReason: endReason is set exactly when lostOn is set',
    ]);
  });
});

describe('organisations', () => {
  it('rejects a controller on a promotion or a brand', () => {
    const controller = { kind: 'computer' };
    expect(parseIssues(recordSchemas.promotion, record('promotion', { controller }))).toEqual([
      ': Unrecognized key: "controller"',
    ]);
    expect(parseIssues(recordSchemas.brand, record('brand', { controller: null }))).toEqual([
      ': Unrecognized key: "controller"',
    ]);
  });

  it('rejects a lowercase short name and a production level above 10', () => {
    expect(
      recordSchemas.promotion.safeParse(record('promotion', { shortName: 'hcw' })).success,
    ).toBe(false);
    const production = { ...VALID_PRODUCTION, pyro: 11 };
    expect(parseIssues(recordSchemas.promotion, record('promotion', { production }))).toEqual([
      'production.pyro: Too big: expected number to be <=10',
    ]);
  });

  it('rejects a promotion that is its own parent', () => {
    const promotion = record('promotion', { parentPromotionKey: 'harbour-city-wrestling' });
    expect(parseIssues(recordSchemas.promotion, promotion)).toEqual([
      'parentPromotionKey: A promotion cannot be its own parent',
    ]);
  });

  it('rejects an event definition with 13 slots or 4 pre-show slots', () => {
    const tooManySlots = record('eventDefinition', { format: { slots: 13, preShowSlots: 0 } });
    expect(parseIssues(recordSchemas.eventDefinition, tooManySlots)).toEqual([
      'format.slots: Too big: expected number to be <=12',
    ]);
    const tooManyPreShow = record('eventDefinition', { format: { slots: 6, preShowSlots: 4 } });
    expect(parseIssues(recordSchemas.eventDefinition, tooManyPreShow)).toEqual([
      'format.preShowSlots: Too big: expected number to be <=3',
    ]);
  });

  it('rejects a lengthMinutes field as an unknown key', () => {
    expect(
      parseIssues(recordSchemas.eventDefinition, record('eventDefinition', { lengthMinutes: 120 })),
    ).toEqual([': Unrecognized key: "lengthMinutes"']);
    const format = { slots: 6, preShowSlots: 0, lengthMinutes: 120 };
    expect(
      parseIssues(recordSchemas.eventDefinition, record('eventDefinition', { format })),
    ).toEqual(['format: Unrecognized key: "lengthMinutes"']);
  });

  it('rejects an everyNWeeks recurrence with intervalWeeks 1', () => {
    const recurrence = { kind: 'everyNWeeks', intervalWeeks: 1, weekday: 0, anchor: '2026-01-05' };
    expect(
      parseIssues(recordSchemas.eventDefinition, record('eventDefinition', { recurrence })),
    ).toEqual(['recurrence.intervalWeeks: Too small: expected number to be >=2']);
  });

  it('rejects a network with no coverage and a deal that ends before it starts', () => {
    const coverage = { continentKeys: [], countryKeys: [], regionKeys: [] };
    expect(parseIssues(recordSchemas.network, record('network', { coverage }))).toEqual([
      'coverage: A network must cover at least one continent, country or region',
    ]);
    expect(parseIssues(recordSchemas.deal, record('deal', { endsOn: '2025-06-30' }))).toEqual([
      'endsOn: endsOn must be after startsOn',
    ]);
  });

  it('rejects a retired title without a retirement date', () => {
    expect(parseIssues(recordSchemas.title, record('title', { status: 'retired' }))).toEqual([
      'retiredOn: retiredOn is set exactly when status is retired',
    ]);
  });
});

describe('names and generation', () => {
  it('rejects a name mix keyed differently from its country', () => {
    const mix = record('countryNameMix', { key: 'somewhere-else' });
    expect(parseIssues(recordSchemas.countryNameMix, mix)).toEqual([
      'key: A country name mix uses its country key as its own key',
    ]);
  });

  it('rejects a zero or fractional name weight and a repeated name', () => {
    for (const male of [
      [['Jack', 0]],
      [['Jack', 1.5]],
      [
        ['Jack', 1],
        ['Jack', 2],
      ],
    ]) {
      const culture = record('nameCulture', {
        given: { male, female: [['Mira', 1]], neutral: [] },
      });
      expect(recordSchemas.nameCulture.safeParse(culture).success).toBe(false);
    }
  });

  it('rejects a ring name pattern with an unknown or no placeholder', () => {
    const unknownPlaceholder = record('ringNameWords', { patterns: [['{colour} {noun}', 1]] });
    expect(parseIssues(recordSchemas.ringNameWords, unknownPlaceholder)[0]).toMatch(
      /^patterns\.0\.0: Unknown placeholder \{colour\}/,
    );
    const noPlaceholder = record('ringNameWords', { patterns: [['The Storm', 1]] });
    expect(parseIssues(recordSchemas.ringNameWords, noPlaceholder)).toEqual([
      'patterns.0.0: A pattern needs at least one placeholder, such as {noun}',
    ]);
  });

  it('rejects a ring name pattern listed twice or with a weight below 1', () => {
    const repeated = record('ringNameWords', {
      patterns: [
        ['{noun}', 2],
        ['{noun}', 3],
      ],
    });
    expect(parseIssues(recordSchemas.ringNameWords, repeated)).toEqual([
      'patterns: Each pattern may appear only once',
    ]);
    const zeroWeight = record('ringNameWords', { patterns: [['{noun}', 0]] });
    expect(recordSchemas.ringNameWords.safeParse(zeroWeight).success).toBe(false);
  });

  it('asks double-surname cultures, and only them, for a double surname chance', () => {
    const doubleWithout = record('nameCulture', { surnameStyle: 'double' });
    expect(parseIssues(recordSchemas.nameCulture, doubleWithout)).toEqual([
      'doubleSurnameChance: A culture with surnameStyle "double" must set doubleSurnameChance',
    ]);
    const doubleWith = record('nameCulture', { surnameStyle: 'double', doubleSurnameChance: 0.35 });
    expect(recordSchemas.nameCulture.safeParse(doubleWith).success).toBe(true);
    const singleWith = record('nameCulture', { doubleSurnameChance: 0.2 });
    expect(parseIssues(recordSchemas.nameCulture, singleWith)).toEqual([
      'doubleSurnameChance: doubleSurnameChance only applies to surnameStyle "double", not "single"',
    ]);
    const outOfRange = record('nameCulture', { surnameStyle: 'double', doubleSurnameChance: 1.5 });
    expect(recordSchemas.nameCulture.safeParse(outOfRange).success).toBe(false);
  });

  it('rejects a generation profile with a misspelt attribute and a role multiplier above 10', () => {
    const attributes = {
      ...ATTRIBUTE_DISTRIBUTIONS,
      stamna: { mean: 50, sd: 10, talentWeight: 0.5 },
    };
    expect(
      parseIssues(recordSchemas.generationProfile, record('generationProfile', { attributes })),
    ).toEqual(['attributes: Unrecognized key: "stamna"']);
    const incidence = record('traitIncidence', { roleMultipliers: { wrestler: 11 } });
    expect(parseIssues(recordSchemas.traitIncidence, incidence)).toEqual([
      'roleMultipliers.wrestler: Too big: expected number to be <=10',
    ]);
  });

  it('rejects generation roles whose shares do not add up or whose skill lists are mixed up', () => {
    const shares = record('generationRole', {
      genderShares: { male: 0.7, female: 0.4, nonBinary: 0.02 },
    });
    expect(parseIssues(recordSchemas.generationRole, shares)).toEqual([
      'genderShares: Shares must add up to 1, got 1.12',
    ]);
    const skills = record('generationRole', { roleSkills: ['ringwork'] });
    expect(parseIssues(recordSchemas.generationRole, skills)[0]).toMatch(
      /^roleSkills\.0: ringwork is not a crew attribute/,
    );
    const performer = record('generationRole', { performerAttributes: ['booking'] });
    expect(parseIssues(recordSchemas.generationRole, performer)[0]).toMatch(
      /^performerAttributes\.0: booking is not an in-ring or character attribute/,
    );
    const ages = record('generationRole', {
      stageAges: {
        rookie: { min: 24, max: 18 },
        prospect: { min: 21, max: 28 },
        established: { min: 26, max: 36 },
        veteran: { min: 33, max: 45 },
        legend: { min: 40, max: 58 },
      },
    });
    expect(parseIssues(recordSchemas.generationRole, ages)).toEqual([
      'stageAges.rookie.max: min must not be greater than max',
    ]);
    const debut = record('generationRole', { debut: { ageSd: 2, minAge: 12, maxAge: 30 } });
    expect(recordSchemas.generationRole.safeParse(debut).success).toBe(false);
    const motivations = record('generationRole', {
      motivationWeights: { money: 0, legacy: 0, power: 0, enjoyment: 0, thrill: 0 },
    });
    expect(parseIssues(recordSchemas.generationRole, motivations)).toEqual([
      'motivationWeights: At least one motivation needs a weight above 0',
    ]);
  });

  it('rejects an archetype missing a ring style and a profile with an unknown career stage', () => {
    const archetype = record('bodyArchetype', {
      styleWeights: { allRounder: 1, technician: 1 },
    });
    expect(recordSchemas.bodyArchetype.safeParse(archetype).success).toBe(false);
    const range = record('bodyArchetype', { heightCm: { min: 190, max: 170 } });
    expect(parseIssues(recordSchemas.bodyArchetype, range)).toEqual([
      'heightCm.max: min must not be greater than max',
    ]);
    const profile = record('generationProfile', { stage: 'superstar' });
    expect(recordSchemas.generationProfile.safeParse(profile).success).toBe(false);
    const style = record('generationStyle', { attributeModifiers: { strength: 4 } });
    expect(recordSchemas.generationStyle.safeParse(style).success).toBe(false);
  });

  it('rejects an unknown trait key and a base chance above 1', () => {
    expect(
      recordSchemas.traitIncidence.safeParse(record('traitIncidence', { traitKey: 'lazy' }))
        .success,
    ).toBe(false);
    expect(
      recordSchemas.traitIncidence.safeParse(record('traitIncidence', { baseChance: 1.2 })).success,
    ).toBe(false);
  });
});

describe('override markers', () => {
  it('accept a patch of a few fields (whether it is allowed is the loader check)', () => {
    const result = recordSchemas.region.safeParse({
      key: 'harbour-coast',
      $override: 'patch',
      wrestlingInterest: 75,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      key: 'harbour-coast',
      $override: 'patch',
      wrestlingInterest: 75,
    });
  });

  it('accept a full replacement and keep the marker for the loader', () => {
    const result = recordSchemas.country.safeParse(record('country', { $override: 'replace' }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ key: 'cormere', $override: 'replace' });
  });

  it('check the fields a patch lists, and nothing else', () => {
    const patch = { key: 'harbour-coast', $override: 'patch', wrestlingInterest: 101 };
    expect(parseIssues(recordSchemas.region, patch)).toEqual([
      'wrestlingInterest: Too big: expected number to be <=100',
    ]);
    // A misspelt field is unknown, so the patch is also left with nothing to change.
    expect(
      parseIssues(recordSchemas.region, { key: 'harbour-coast', $override: 'patch', colour: 1 }),
    ).toEqual([': Unrecognized key: "colour"', ': A patch must list at least one field to change']);
  });

  it('reject an empty patch, an unknown mode and a removal with other fields', () => {
    expect(parseIssues(recordSchemas.region, { key: 'harbour-coast', $override: 'patch' })).toEqual(
      [': A patch must list at least one field to change'],
    );
    expect(parseIssues(recordSchemas.region, record('region', { $override: 'merge' }))).toEqual([
      '$override: Expected "$override" to be "replace" or "patch"',
    ]);
    expect(
      parseIssues(recordSchemas.region, { key: 'harbour-coast', $remove: true, name: 'X' }),
    ).toEqual([': Unrecognized key: "name"']);
    expect(parseIssues(recordSchemas.region, { key: 'harbour-coast', $remove: false })).toEqual([
      '$remove: Invalid input: expected true',
    ]);
  });

  it('a replacement must be a complete record', () => {
    const replacement = { key: 'cormere', $override: 'replace', economy: 70 };
    expect(recordSchemas.country.safeParse(replacement).success).toBe(false);
  });

  it('reject an entry that is not an object', () => {
    expect(parseIssues(recordSchemas.continent, ['arden'])).toEqual([': Expected a record object']);
  });
});

describe('record files', () => {
  it('parse an array of entries', () => {
    const file = [VALID_RECORDS.continent, { key: 'other', name: 'Other', code: 'OTH' }];
    expect(parseIssues(recordFileSchema('continent'), file)).toEqual([]);
  });

  it('reject a key used twice in one file', () => {
    const file = [VALID_RECORDS.continent, { key: 'arden', $remove: true }];
    expect(parseIssues(recordFileSchema('continent'), file)).toEqual([
      '1.key: Key arden is already used by entry 0 in this file',
    ]);
  });

  it('report the index of a bad record', () => {
    const file = [VALID_RECORDS.continent, { key: 'other', name: 'Other', code: 'oth' }];
    expect(parseIssues(recordFileSchema('continent'), file)).toEqual([
      '1.code: Expected a code of two or three uppercase letters',
    ]);
  });
});

describe('the worked example in docs/design/data-packs.md', () => {
  const example = readExamplePack();

  it('has a manifest and the files it lists', () => {
    const manifest = packManifestSchema.parse(example.get('pack.json'));
    const listedFiles = Object.values(manifest.files).sort();
    const docFiles = [...example.keys()].filter((path) => path !== 'pack.json').sort();
    expect(docFiles).toEqual(listedFiles);
    expect(Object.keys(manifest.files).sort()).toEqual(
      ['continent', 'country', 'region', 'person', 'promotion', 'employment'].sort(),
    );
  });

  it('every file parses as records of its kind', () => {
    const manifest = packManifestSchema.parse(example.get('pack.json'));
    for (const kind of RECORD_KINDS) {
      const path = manifest.files[kind];
      if (path === undefined) {
        continue;
      }
      expect(parseIssues(recordFileSchema(kind), example.get(path)), path).toEqual([]);
    }
  });

  it('every reference points at a record in the example', () => {
    const keys = new Set<string>();
    const references: string[] = [];
    function collect(value: unknown, field: string): void {
      if (Array.isArray(value)) {
        for (const item of value) {
          collect(item, field);
        }
        return;
      }
      if (isObject(value)) {
        for (const [name, child] of Object.entries(value)) {
          if (name === 'regionalPop' && isObject(child)) {
            references.push(...Object.keys(child));
          }
          collect(child, name);
        }
        return;
      }
      if (typeof value !== 'string') {
        return;
      }
      if (field === 'key') {
        keys.add(value);
      } else if (/Keys?$/.test(field)) {
        references.push(value);
      }
    }
    for (const [path, content] of example) {
      if (path !== 'pack.json') {
        collect(content, '');
      }
    }
    expect(references.length).toBeGreaterThan(0);
    expect(references.filter((reference) => !keys.has(reference))).toEqual([]);
  });
});
