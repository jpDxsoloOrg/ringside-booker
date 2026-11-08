/**
 * The shapes the roster build works with: a roster member while it is being built, and the plain
 * JSON records it writes. Records are written with plain strings; `output.ts` parses every file
 * with the engine's pack schemas before it is written.
 */

import type {
  Alignment,
  AttributeKey,
  CareerStage,
  GameDate,
  Gender,
  Person,
  Push,
} from '@ringside/engine';
import type { Headliner, StaffRole, Tier } from './specSchema';

/** What someone is hired (or available) as. */
export type RosterRole = 'wrestler' | StaffRole;

/** One person in the build, with everything the later steps add to them. */
export interface RosterMember {
  readonly key: string;
  /** The engine person; regional popularity and the based-in region change during the build. */
  person: Person;
  readonly talent: number;
  readonly stage: CareerStage;
  readonly role: RosterRole;
  /** The promotion they work for, or null for a free agent. */
  readonly promotionKey: string | null;
  readonly headliner: Headliner | null;
  /** The name they work under: a generated ring name for wrestlers and managers. */
  ringName: string;
  /** Popularity in their home region as generated, before popularity fitting. */
  readonly homePopularity: number;
  /** Mean performer attribute plus the weighted home popularity; 0 for staff. */
  cardValue: number;
  push: Push;
  alignment: Alignment;
  brandKey: string | null;
}

/** A promotion as the build sees it. */
export interface RosterPromotion {
  readonly key: string;
  readonly tier: Tier;
  readonly homeRegionKey: string;
  /** Region key → the promotion's popularity there. */
  readonly regionalPop: Readonly<Record<string, number>>;
}

/** A title as the build sees it. */
export interface RosterTitle {
  readonly key: string;
  readonly promotionKey: string;
  readonly brandKey: string | null;
  readonly holderCount: number;
  readonly gender: 'open' | Gender;
  readonly minWeightKg: number | null;
  readonly maxWeightKg: number | null;
  readonly introducedOn: GameDate;
}

export interface PersonOut {
  key: string;
  givenName: string;
  familyName: string;
  defaultRingName: string;
  gender: Gender;
  birthDate: string;
  debutDate: string | null;
  birthRegionKey: string;
  basedInRegionKey: string;
  masked: boolean;
  tags: string[];
  roles: string[];
  career: { canOwn: boolean; canBook: boolean };
  motivation: string;
  heightCm: number;
  weightKg: number;
  build: string;
  style: string;
  attributes: Record<AttributeKey, number>;
  condition: Record<string, number>;
  development: { potential: number; ceilings: Record<string, number> };
  regionalPop: Record<string, number>;
  traits: string[];
  vices: { alcohol: string; substances: string };
}

export interface ContractTermsOut {
  kind: 'written' | 'perAppearance';
  exclusive: boolean;
  monthlyWage: number;
  perAppearanceFee: number;
  signingBonus: number;
  shares: { gateBp: number; merchBp: number; broadcastBp: number };
  appearanceCap: number | null;
  perks: {
    creativeControl: boolean;
    noHouseShows: boolean;
    ironClad: boolean;
    travelCovered: boolean;
  };
}

export interface EmploymentOut {
  key: string;
  personKey: string;
  promotionKey: string;
  brandKey: string | null;
  role: RosterRole;
  ringName: string;
  alignment: Alignment;
  push: Push;
  terms: ContractTermsOut;
  startsOn: GameDate;
  endsOn: GameDate;
}

export interface TeamOut {
  key: string;
  kind: 'tag' | 'trio';
  name: string;
  memberKeys: string[];
  formedOn: GameDate;
  experience: number;
  status: 'active';
}

export interface ReignOut {
  key: string;
  titleKey: string;
  holderPersonKeys: string[];
  teamKey: string | null;
  wonOn: GameDate;
  lostOn: GameDate | null;
  endReason: 'lost' | null;
  defences: number;
}
