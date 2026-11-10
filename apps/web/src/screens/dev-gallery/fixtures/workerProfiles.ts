/**
 * Placeholder profile headers for the gallery, shaped as `workers.profile` returns them. The
 * people are made up; the weight class breakdown follows the engine's own (a decision with the
 * four limits as game settings).
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type { TraceNode, WeightClass, WorkerProfileHeader } from '@ringside/engine';

const HOME_REGION = parseId('region', 'reg_0000000001');
const HOME = { regionId: HOME_REGION, regionName: 'Gallery North', countryName: 'Galleria' };

const WEIGHT_LIMITS: readonly {
  readonly key: string;
  readonly label: string;
  readonly kg: number;
}[] = [
  { key: 'workers.weightClass.lightweightMaxKg', label: 'Lightweight', kg: 70 },
  { key: 'workers.weightClass.cruiserweightMaxKg', label: 'Cruiserweight', kg: 93 },
  { key: 'workers.weightClass.lightHeavyweightMaxKg', label: 'Light heavyweight', kg: 105 },
  { key: 'workers.weightClass.heavyweightMaxKg', label: 'Heavyweight', kg: 130 },
];

/** The weight class answer for a weight, with the breakdown the engine would give. */
function weightClassOf(
  weightKg: number,
  value: WeightClass,
  reason: string,
): WorkerProfileHeader['weightClass'] {
  const children: TraceNode[] = WEIGHT_LIMITS.flatMap((limit): TraceNode[] => {
    const condition = `${String(weightKg)} kg is over the ${limit.label} limit of ${String(limit.kg)} kg`;
    return [
      {
        kind: 'tunable',
        label: `${limit.label} limit`,
        key: limit.key,
        value: limit.kg,
        defaultValue: limit.kg,
        overridden: false,
        unit: 'kilograms',
      },
      {
        kind: 'branch',
        label: condition,
        value: weightKg > limit.kg,
        condition,
        taken: weightKg > limit.kg,
      },
    ];
  });
  return {
    value,
    trace: {
      kind: 'decision',
      label: 'Weight class',
      value,
      chosen: value,
      reason,
      considered: [],
      children,
    },
  };
}

/** A champion on the player's own roster: every fact filled in, a face, fit to work. */
export const galleryOwnHeader: WorkerProfileHeader = {
  personId: parseId('person', 'per_0000000101'),
  ringName: 'Gallery Champion',
  legalName: 'Sample Person',
  imageRef: null,
  masked: false,
  gender: 'female',
  age: 29,
  heightCm: 172,
  weightKg: 68,
  weightClass: weightClassOf(68, 'lightweight', '68 kg is within the Lightweight limit of 70 kg'),
  style: 'technician',
  basedIn: HOME,
  born: HOME,
  roles: ['wrestler'],
  status: 'active',
  mainRole: 'wrestler',
  debutDate: parseGameDate('2019-03-02'),
  experienceYears: 7.1,
  employer: {
    promotionId: parseId('promotion', 'pro_0000000001'),
    name: 'Gallery Wrestling Federation',
    shortName: 'GWF',
    isViewers: true,
  },
  push: 'mainEvent',
  alignment: 'face',
  availability: { status: 'available', reason: 'Available', until: null, canWorkAngles: true },
};

/** A rival's injured heel with a ring name long enough to wrap, and a different legal name. */
export const galleryLongNameHeader: WorkerProfileHeader = {
  ...galleryOwnHeader,
  personId: parseId('person', 'per_0000000102'),
  ringName: 'The Incomparable Grand Duke Maximilian Thunderstone the Third',
  legalName: 'Another Sample Person',
  gender: 'male',
  age: 41,
  heightCm: 198,
  weightKg: 141,
  weightClass: weightClassOf(
    141,
    'superHeavyweight',
    '141 kg is over the Heavyweight limit of 130 kg',
  ),
  style: 'powerhouse',
  employer: {
    promotionId: parseId('promotion', 'pro_0000000002'),
    name: 'Placeholder Pro Wrestling Alliance of the Northern Territories',
    shortName: 'PPW',
    isViewers: false,
  },
  push: 'upperCard',
  alignment: 'heel',
  availability: {
    status: 'injured',
    reason: 'Injured (knee injury)',
    until: parseGameDate('2026-04-14'),
    canWorkAngles: true,
  },
};

/** A free agent who has not debuted: no employer, push or alignment, ring name and legal name the same. */
export const galleryFreeAgentHeader: WorkerProfileHeader = {
  ...galleryOwnHeader,
  personId: parseId('person', 'per_0000000103'),
  ringName: 'Sample Rookie',
  legalName: 'Sample Rookie',
  gender: 'nonBinary',
  age: 19,
  heightCm: 180,
  weightKg: 88,
  weightClass: weightClassOf(
    88,
    'cruiserweight',
    '88 kg is within the Cruiserweight limit of 93 kg',
  ),
  style: 'highFlyer',
  debutDate: null,
  experienceYears: 0,
  employer: null,
  push: null,
  alignment: null,
  availability: {
    status: 'notDebuted',
    reason: 'Has not debuted yet',
    until: null,
    canWorkAngles: false,
  },
};
