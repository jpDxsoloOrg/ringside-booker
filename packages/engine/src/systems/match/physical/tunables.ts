/**
 * The physical toll's balance numbers (MTCH4-01): how much fatigue one worker gains in one match and
 * how much body condition they lose.
 *
 * `match.fatigue.*`: the fatigue a match costs by duration class, shared out among the workers,
 * eased by stamina and moved by style, effort traits, a house show, keep-it-safe and working more
 * than once on one card. `match.wear.*`: the wear load (condition points at part weight 1) by
 * duration class, moved by the worker's own style, the roughest opponent, the opponents' safety,
 * body traits, a house show and keep-it-safe, with one roughness roll; then spread over the body by
 * the part weights.
 *
 * Every key has a minimum of 0, so setting one to 0 means exactly 0.
 *
 * Design: docs/design/physical-toll.md#fatigue-gain and #wear.
 */

import { defineTunables } from '../../../core/tunables/define';
import type { BodyPart, RingStyle } from '../../../model/entities/person';
import { BODY_PART_LABELS, STYLE_LABELS } from '../../world/people/labels';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';

const PHYSICAL_CATEGORY = 'Physical toll';
const FATIGUE_DOC = 'physical-toll.md#fatigue-gain';
const WEAR_DOC = 'physical-toll.md#wear';

type PhysicalUnit = 'points' | 'ratio' | 'multiplier';

function physicalNumber(
  defaultValue: number,
  range: { max: number; step: number },
  unit: PhysicalUnit,
  docRef: string,
  description: string,
) {
  return {
    kind: 'number',
    default: defaultValue,
    min: 0,
    max: range.max,
    step: range.step,
    unit,
    category: PHYSICAL_CATEGORY,
    description,
    docRef,
  } as const;
}

/** A 0..3 multiplier in steps of 0.05. */
function factor(defaultValue: number, docRef: string, description: string) {
  return physicalNumber(defaultValue, { max: 3, step: 0.05 }, 'multiplier', docRef, description);
}

function fatigueBase(durationClass: DurationClass, defaultValue: number) {
  const word = DURATION_CLASS_LABELS[durationClass].toLowerCase();
  return physicalNumber(
    defaultValue,
    { max: 100, step: 0.5 },
    'points',
    FATIGUE_DOC,
    `Fatigue a ${word} match costs one worker before anything moves it`,
  );
}

function wearBase(durationClass: DurationClass, defaultValue: number) {
  const word = DURATION_CLASS_LABELS[durationClass].toLowerCase();
  return physicalNumber(
    defaultValue,
    { max: 5, step: 0.05 },
    'points',
    WEAR_DOC,
    `Body wear a ${word} match costs one worker before anything moves it`,
  );
}

const FATIGUE_STYLE_DEFAULTS: Readonly<Record<RingStyle, number>> = {
  allRounder: 1,
  technician: 1,
  brawler: 1,
  highFlyer: 1.15,
  powerhouse: 1.1,
  hardcore: 1.15,
  striker: 1.05,
  grappler: 1,
  showman: 0.9,
  nonWrestler: 0.8,
};

const WEAR_SELF_STYLE_DEFAULTS: Readonly<Record<RingStyle, number>> = {
  allRounder: 1,
  technician: 1,
  brawler: 1,
  highFlyer: 1.5,
  powerhouse: 1.2,
  hardcore: 1.5,
  striker: 1,
  grappler: 1,
  showman: 1,
  nonWrestler: 0.5,
};

const WEAR_OPPONENT_STYLE_DEFAULTS: Readonly<Record<RingStyle, number>> = {
  allRounder: 1,
  technician: 1.1,
  brawler: 1.2,
  highFlyer: 1,
  powerhouse: 1.2,
  hardcore: 1.3,
  striker: 1.3,
  grappler: 0.85,
  showman: 1,
  nonWrestler: 1,
};

const PART_WEIGHT_DEFAULTS: Readonly<Record<BodyPart, number>> = {
  head: 0.6,
  neck: 0.8,
  back: 1,
  arms: 0.9,
  torso: 0.8,
  legs: 1,
};

function fatigueStyle(style: RingStyle) {
  return factor(
    FATIGUE_STYLE_DEFAULTS[style],
    FATIGUE_DOC,
    `How tiring a ${STYLE_LABELS[style].toLowerCase()} finds a match`,
  );
}

function wearSelfStyle(style: RingStyle) {
  return factor(
    WEAR_SELF_STYLE_DEFAULTS[style],
    WEAR_DOC,
    `How hard a ${STYLE_LABELS[style].toLowerCase()}'s own style is on their body`,
  );
}

function wearOpponentStyle(style: RingStyle) {
  return factor(
    WEAR_OPPONENT_STYLE_DEFAULTS[style],
    WEAR_DOC,
    `How rough a ${STYLE_LABELS[style].toLowerCase()} opponent is`,
  );
}

function partWeight(part: BodyPart) {
  return factor(
    PART_WEIGHT_DEFAULTS[part],
    WEAR_DOC,
    `Share of a match's wear that lands on the ${BODY_PART_LABELS[part].toLowerCase()}`,
  );
}

export const physicalTunables = defineTunables({
  // Fatigue gain
  'match.fatigue.base.short': fatigueBase('short', 4),
  'match.fatigue.base.standard': fatigueBase('standard', 7),
  'match.fatigue.base.long': fatigueBase('long', 12),
  'match.fatigue.minShare': physicalNumber(
    0.35,
    { max: 1, step: 0.05 },
    'ratio',
    FATIGUE_DOC,
    'Smallest share of the workload one worker carries in a crowded match; 1 turns sharing off',
  ),
  'match.fatigue.staminaRelief': physicalNumber(
    0.006,
    { max: 0.02, step: 0.001 },
    'ratio',
    FATIGUE_DOC,
    'Fatigue eased per point of stamina above 50 (added per point below)',
  ),
  'match.fatigue.style.allRounder': fatigueStyle('allRounder'),
  'match.fatigue.style.technician': fatigueStyle('technician'),
  'match.fatigue.style.brawler': fatigueStyle('brawler'),
  'match.fatigue.style.highFlyer': fatigueStyle('highFlyer'),
  'match.fatigue.style.powerhouse': fatigueStyle('powerhouse'),
  'match.fatigue.style.hardcore': fatigueStyle('hardcore'),
  'match.fatigue.style.striker': fatigueStyle('striker'),
  'match.fatigue.style.grappler': fatigueStyle('grappler'),
  'match.fatigue.style.showman': fatigueStyle('showman'),
  'match.fatigue.style.nonWrestler': fatigueStyle('nonWrestler'),
  'match.fatigue.workhorseFactor': factor(1.15, FATIGUE_DOC, 'Extra fatigue for a workhorse'),
  'match.fatigue.coasterFactor': factor(0.85, FATIGUE_DOC, 'Less fatigue for a coaster'),
  'match.fatigue.houseShowFactor': factor(0.6, FATIGUE_DOC, 'Fatigue at a house show'),
  'match.fatigue.keepItSafeFactor': factor(0.8, FATIGUE_DOC, 'Fatigue when told to keep it safe'),
  'match.fatigue.repeatMatch': factor(
    1.5,
    FATIGUE_DOC,
    'Fatigue and wear for each match after the first on the same card, compounding',
  ),
  'match.fatigue.maxPerSegment': physicalNumber(
    40,
    { max: 100, step: 1 },
    'points',
    FATIGUE_DOC,
    'Most fatigue one match can add',
  ),

  // Wear
  'match.wear.base.short': wearBase('short', 0.2),
  'match.wear.base.standard': wearBase('standard', 0.35),
  'match.wear.base.long': wearBase('long', 0.6),
  'match.wear.selfStyle.allRounder': wearSelfStyle('allRounder'),
  'match.wear.selfStyle.technician': wearSelfStyle('technician'),
  'match.wear.selfStyle.brawler': wearSelfStyle('brawler'),
  'match.wear.selfStyle.highFlyer': wearSelfStyle('highFlyer'),
  'match.wear.selfStyle.powerhouse': wearSelfStyle('powerhouse'),
  'match.wear.selfStyle.hardcore': wearSelfStyle('hardcore'),
  'match.wear.selfStyle.striker': wearSelfStyle('striker'),
  'match.wear.selfStyle.grappler': wearSelfStyle('grappler'),
  'match.wear.selfStyle.showman': wearSelfStyle('showman'),
  'match.wear.selfStyle.nonWrestler': wearSelfStyle('nonWrestler'),
  'match.wear.opponentStyle.allRounder': wearOpponentStyle('allRounder'),
  'match.wear.opponentStyle.technician': wearOpponentStyle('technician'),
  'match.wear.opponentStyle.brawler': wearOpponentStyle('brawler'),
  'match.wear.opponentStyle.highFlyer': wearOpponentStyle('highFlyer'),
  'match.wear.opponentStyle.powerhouse': wearOpponentStyle('powerhouse'),
  'match.wear.opponentStyle.hardcore': wearOpponentStyle('hardcore'),
  'match.wear.opponentStyle.striker': wearOpponentStyle('striker'),
  'match.wear.opponentStyle.grappler': wearOpponentStyle('grappler'),
  'match.wear.opponentStyle.showman': wearOpponentStyle('showman'),
  'match.wear.opponentStyle.nonWrestler': wearOpponentStyle('nonWrestler'),
  'match.wear.safetyWeight': physicalNumber(
    0.008,
    { max: 0.05, step: 0.001 },
    'ratio',
    WEAR_DOC,
    "Wear added per point the opponents' average safety is below 50 (taken off above)",
  ),
  'match.wear.minSafetyFactor': factor(0.6, WEAR_DOC, 'Least wear safe opponents can bring it to'),
  'match.wear.maxSafetyFactor': factor(
    1.4,
    WEAR_DOC,
    'Most wear careless opponents can bring it to',
  ),
  'match.wear.durableFactor': factor(0.7, WEAR_DOC, 'Wear for a durable worker'),
  'match.wear.injuryProneFactor': factor(1.3, WEAR_DOC, 'Wear for an injury-prone worker'),
  'match.wear.houseShowFactor': factor(0.6, WEAR_DOC, 'Wear at a house show'),
  'match.wear.keepItSafeFactor': factor(0.5, WEAR_DOC, 'Wear when told to keep it safe'),
  'match.wear.spread': physicalNumber(
    0.5,
    { max: 1, step: 0.05 },
    'ratio',
    WEAR_DOC,
    'How far the roughness roll moves wear either way; 0 means no randomness',
  ),
  'match.wear.maxPerSegment': physicalNumber(
    5,
    { max: 100, step: 0.5 },
    'points',
    WEAR_DOC,
    'Most wear one match can cost, before it is spread over the body',
  ),
  'match.wear.part.head': partWeight('head'),
  'match.wear.part.neck': partWeight('neck'),
  'match.wear.part.back': partWeight('back'),
  'match.wear.part.arms': partWeight('arms'),
  'match.wear.part.torso': partWeight('torso'),
  'match.wear.part.legs': partWeight('legs'),
});
