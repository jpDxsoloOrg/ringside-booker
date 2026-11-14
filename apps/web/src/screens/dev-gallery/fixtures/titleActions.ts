import { parseGameDate, parseId } from '@ringside/engine';
import type {
  Availability,
  EligibleHolders,
  EligiblePerson,
  IneligiblePerson,
  Push,
  WeightClass,
} from '@ringside/engine';
import type { TitleFormBrand } from '@/screens/titles/TitleFormSheet';

/**
 * Sample data for the title action sheets' gallery entries (CRTV1-05): the brands the form offers
 * and `titles.eligibleHolders` answers for a women's singles title and a tag title. Gallery data
 * only: fictional names, fixed numbers.
 */

const MAINSTAGE = parseId('brand', 'brd_0000000301');
const OVERCLOCK = parseId('brand', 'brd_0000000302');

export const galleryTitleBrands: readonly TitleFormBrand[] = [
  { brandId: MAINSTAGE, name: 'Gallery Mainstage' },
  { brandId: OVERCLOCK, name: 'Gallery Overclock' },
];

const AVAILABLE: Availability = {
  status: 'available',
  reason: 'Available',
  until: null,
  canWorkAngles: true,
};

const INJURED: Availability = {
  status: 'injured',
  reason: 'Injured: knee',
  until: parseGameDate('2027-07-14'),
  canWorkAngles: false,
};

interface PersonSeed {
  readonly number: number;
  readonly ringName: string;
  readonly weightKg: number;
  readonly weightClass: WeightClass;
  readonly push: Push;
  readonly onMainstage: boolean;
  readonly injured?: boolean;
  readonly champion?: boolean;
}

function person(seed: PersonSeed): EligiblePerson {
  return {
    personId: parseId('person', `per_${String(300 + seed.number).padStart(10, '0')}`),
    ringName: seed.ringName,
    imageRef: null,
    gender: 'female',
    weightKg: seed.weightKg,
    weightClass: seed.weightClass,
    push: seed.push,
    brandId: seed.onMainstage ? MAINSTAGE : OVERCLOCK,
    brandName: seed.onMainstage ? 'Gallery Mainstage' : 'Gallery Overclock',
    sameBrand: seed.onMainstage,
    availability: seed.injured === true ? INJURED : AVAILABLE,
    isCurrentHolder: seed.champion === true,
  };
}

const WOMEN: readonly EligiblePerson[] = [
  person({
    number: 1,
    ringName: 'Gallery Vera Quill',
    weightKg: 61,
    weightClass: 'lightweight',
    push: 'mainEvent',
    onMainstage: true,
    champion: true,
  }),
  person({
    number: 2,
    ringName: 'Gallery Nova Reyes',
    weightKg: 66,
    weightClass: 'lightweight',
    push: 'upperCard',
    onMainstage: true,
  }),
  person({
    number: 3,
    ringName: 'Gallery Ida Marsh',
    weightKg: 74,
    weightClass: 'cruiserweight',
    push: 'midCard',
    onMainstage: true,
    injured: true,
  }),
  person({
    number: 4,
    ringName: 'Gallery Wren Okafor-Lindqvist',
    weightKg: 58,
    weightClass: 'lightweight',
    push: 'midCard',
    onMainstage: false,
  }),
];

function ineligible(number: number, ringName: string, message: string): IneligiblePerson {
  return {
    personId: parseId('person', `per_${String(350 + number).padStart(10, '0')}`),
    ringName,
    reasons: [{ code: 'divisionGender', message }],
  };
}

const MEN: readonly IneligiblePerson[] = [
  ineligible(1, 'Gallery Dax Hollow', "The Gallery Women's Title is a women's title"),
  ineligible(2, 'Gallery Rook Tamsin', "The Gallery Women's Title is a women's title"),
];

/** A women's singles title held by Vera Quill: four who can hold it, two men who can't. */
export function galleryWomensHolders(includeIneligible: boolean): EligibleHolders {
  return {
    holderCount: 1,
    teams: [],
    people: [...WOMEN],
    ineligible: includeIneligible ? [...MEN] : [],
  };
}

/** A tag title: one team that could hold it, then everyone, nobody left out. */
export function galleryTagHolders(): EligibleHolders {
  const [vera, nova, ida, wren] = WOMEN;
  if (vera === undefined || nova === undefined || ida === undefined || wren === undefined) {
    throw new Error('The gallery roster lost a wrestler.');
  }
  const plain = [vera, nova, ida, wren].map((entry) => ({ ...entry, isCurrentHolder: false }));
  return {
    holderCount: 2,
    teams: [
      {
        teamId: parseId('team', 'tem_0000000301'),
        name: 'Gallery Night Shift',
        kind: 'tag',
        members: [
          { personId: nova.personId, ringName: nova.ringName },
          { personId: wren.personId, ringName: wren.ringName },
        ],
        sameBrand: false,
        isCurrentHolder: false,
      },
    ],
    people: plain,
    ineligible: [],
  };
}
