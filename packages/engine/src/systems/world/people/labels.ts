/** Player-facing words for the people generator's trace labels. */

import type {
  AttributeKey,
  BodyPart,
  Gender,
  PersonRole,
  RingStyle,
} from '../../../model/entities/person';
import type { CareerStage } from '../../../persistence/packs/records/generation';

export const ATTRIBUTE_LABELS: Readonly<Record<AttributeKey, string>> = {
  ringwork: 'Ring work',
  psychology: 'Psychology',
  stamina: 'Stamina',
  safety: 'Safety',
  athleticism: 'Athleticism',
  mic: 'Mic skills',
  charisma: 'Charisma',
  presence: 'Presence',
  officiating: 'Officiating',
  broadcasting: 'Broadcasting',
  producing: 'Producing',
  booking: 'Booking',
};

export const STYLE_LABELS: Readonly<Record<RingStyle, string>> = {
  allRounder: 'All-rounder',
  technician: 'Technician',
  brawler: 'Brawler',
  highFlyer: 'High flyer',
  powerhouse: 'Powerhouse',
  hardcore: 'Hardcore',
  striker: 'Striker',
  grappler: 'Grappler',
  showman: 'Showman',
  nonWrestler: 'Non-wrestler',
};

export const BODY_PART_LABELS: Readonly<Record<BodyPart, string>> = {
  head: 'Head',
  neck: 'Neck',
  back: 'Back',
  arms: 'Arms',
  torso: 'Torso',
  legs: 'Legs',
};

export const STAGE_LABELS: Readonly<Record<CareerStage, string>> = {
  rookie: 'Rookie',
  prospect: 'Prospect',
  established: 'Established',
  veteran: 'Veteran',
  legend: 'Legend',
};

export const ROLE_LABELS: Readonly<Record<PersonRole, string>> = {
  wrestler: 'wrestler',
  occasionalWrestler: 'occasional wrestler',
  manager: 'manager',
  presenter: 'presenter',
  announcer: 'announcer',
  referee: 'referee',
  producer: 'producer',
};

export const GENDER_LABELS: Readonly<Record<Gender, string>> = {
  male: 'Man',
  female: 'Woman',
  nonBinary: 'Non-binary',
};

/** A number for a trace reason, to at most two decimals. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
