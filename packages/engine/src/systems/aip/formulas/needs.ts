/**
 * Roster needs: what a promotion's roster is short of, each with how pressing it is (0-100).
 *
 * - depth per push band, against the slots its largest show calls for (D-10: slots, never
 *   minutes);
 * - each gender division that has a title;
 * - faces against heels;
 * - champions who have left, cannot defend or whose contracts are ending;
 * - crew (referees, announcers, producers).
 *
 * `rosterReviewDecision` turns the list into the weekly roster review's Why? (AIP1-05 stores it).
 *
 * Design: docs/design/rival-desk.md#needs.
 */

import { dayOfMonth, diffDays, yearMonthOf, type GameDate } from '../../../core/date';
import { parseContentKey } from '../../../core/content-key';
import type { PersonId, TitleId } from '../../../core/ids';
import {
  constantOf,
  inputOf,
  startCalc,
  startDecision,
  type Calc,
  type Traced,
} from '../../../core/trace';
import type { Alignment, Push } from '../../../model/entities/employment';
import type { Gender } from '../../../model/entities/person';
import type { TemplatedText } from '../../../model/primitives';
import { monthLabel } from '../../finance/months';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { PUSH_LABELS } from '../../workers/formulas/expectedPush';
import { NEEDS_DOC_REF } from '../needsTunables';

export type NeedKind = 'depth' | 'gender' | 'alignment' | 'champion' | 'crew';

/** The divisions a title can be for. */
export type DivisionGender = 'male' | 'female';

/** The crew roles a roster is checked for. */
export const NEED_CREW_ROLES = ['referee', 'announcer', 'producer'] as const;
export type NeedCrewRole = (typeof NEED_CREW_ROLES)[number];

/** The push bands a roster is checked for, top down. */
export const NEED_BANDS = [
  'mainEvent',
  'upperCard',
  'midCard',
  'lowerCard',
  'enhancement',
] as const;
export type NeedBand = (typeof NEED_BANDS)[number];

export interface NeedsWrestler {
  personId: PersonId;
  name: string;
  gender: Gender;
  push: Push;
  alignment: Alignment;
  /** False when the wrestler cannot work (injured, suspended, away). */
  available: boolean;
}

export interface NeedsChampion {
  titleId: TitleId;
  titleName: string;
  personIds: readonly PersonId[];
  names: readonly string[];
  /** Why the holder cannot defend, or null when they can. */
  unfitReason: string | null;
  contractEndsOn: GameDate | null;
  /** False when the holder no longer works for the promotion. */
  employed: boolean;
}

export interface NeedsInputs {
  unitName: string;
  /** Slots of the unit's largest active show, or null when it has none. */
  largestShowSlots: number | null;
  wrestlers: readonly NeedsWrestler[];
  /** The divisions the unit has a title for. */
  genderDivisions: readonly DivisionGender[];
  champions: readonly NeedsChampion[];
  crewCounts: Readonly<Record<NeedCrewRole, number>>;
  today: GameDate;
}

export interface NeedRefs {
  personIds: PersonId[];
  titleIds: TitleId[];
}

export interface Need {
  /** Unique within one review: `depth.mainEvent`, `champion.<titleId>.unfit`, ... */
  key: string;
  kind: NeedKind;
  summary: TemplatedText;
  severity: Traced<number>;
  refs: NeedRefs;
}

/** A need whose severity is still being worked out: `finishNeed` clamps it and checks the threshold. */
type FoundNeed = Omit<Need, 'severity'> & { severity: Calc };

/** The ends of the severity scale. */
export const SEVERITY_MIN = 0;
export const SEVERITY_MAX = 100;

const BAND_SHARE_KEYS: Readonly<Record<NeedBand, NumberTunableKey>> = {
  mainEvent: 'aip.needs.bandShare.mainEvent',
  upperCard: 'aip.needs.bandShare.upperCard',
  midCard: 'aip.needs.bandShare.midCard',
  lowerCard: 'aip.needs.bandShare.lowerCard',
  enhancement: 'aip.needs.bandShare.enhancement',
};

const CREW_MINIMUM_KEYS: Readonly<Record<NeedCrewRole, NumberTunableKey>> = {
  referee: 'aip.needs.minReferees',
  announcer: 'aip.needs.minAnnouncers',
  producer: 'aip.needs.minProducers',
};

const CREW_LABELS: Readonly<Record<NeedCrewRole, string>> = {
  referee: 'referees',
  announcer: 'announcers',
  producer: 'producers',
};

const DIVISION_LABELS: Readonly<Record<DivisionGender, string>> = {
  male: "Men's division",
  female: "Women's division",
};

export const NO_NEEDS_REASON = 'No needs above the threshold';
export const TOP_NEED_REASON = 'Most pressing need';
export const ROSTER_REVIEW_LABEL = 'Weekly roster review';

/** A summary as stored: a content key and short params. */
function summaryOf(key: string, params: Record<string, string | number>): TemplatedText {
  return { key: parseContentKey(key), params };
}

/** "12 March 2027". */
function dateText(date: GameDate): string {
  return `${String(dayOfMonth(date))} ${monthLabel(yearMonthOf(date))}`;
}

function param(summary: TemplatedText, name: string): string {
  const value = summary.params[name];
  return value === undefined ? '' : String(value);
}

/**
 * A need's summary in plain English. The web text catalog (AIP1-06) renders the same keys; this
 * is what the roster review's Why? lists.
 */
export function needSummaryText(summary: TemplatedText): string {
  const value = (name: string): string => param(summary, name);
  switch (summary.key) {
    case 'aip.need.depth':
      return `Thin at ${value('band').toLowerCase()}: ${value('have')} of ${value('target')}`;
    case 'aip.need.alignment.heels':
      return 'Short on heels';
    case 'aip.need.alignment.faces':
      return 'Short on faces';
    case 'aip.need.gender':
      return `${value('division')} thin: ${value('have')} of ${value('target')}`;
    case 'aip.need.champion-gone':
      return `Champion has left: ${value('title')}`;
    case 'aip.need.champion-unfit':
      return `Champion unfit: ${value('names')}, ${value('reason')}`;
    case 'aip.need.champion-ending':
      return `Champion's contract ends ${value('date')}`;
    case 'aip.need.crew':
      return `Short of ${value('role')}: ${value('have')} of ${value('target')}`;
    default:
      return summary.key;
  }
}

function severityCalc(label: string): Calc {
  return startCalc(label, 0, {
    unit: 'points',
    docRef: NEEDS_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
}

/** `(target − have) ÷ target × 100`: the share of a target that is missing, as points. */
function shortfallSeverity(
  label: string,
  target: Traced<number>,
  have: number,
  haveLabel: string,
): Calc {
  return startCalc(label, target, { unit: 'points', docRef: NEEDS_DOC_REF })
    .subtract(haveLabel, have)
    .divide(`Of ${formatNumber(target.value)} wanted`, target.value)
    .multiply(
      'As points',
      constantOf('Points for a whole target missing', SEVERITY_MAX, 'Severity runs from 0 to 100'),
    );
}

/** A target read straight from a tunable, as a traced number. */
function tunableTarget(
  label: string,
  key: NumberTunableKey,
  tunables: EngineTunables,
): Traced<number> {
  const calc = startCalc(label, 0, { unit: 'count', startLabel: 'Nothing counted yet' });
  return calc.add('Wanted', calc.tunable(tunables, key)).done();
}

/**
 * Wrestlers the unit's shows call for: `(largestShowSlots ?? aip.needs.defaultSlots) ×
 * aip.needs.workersPerSlot`.
 */
export function slotsDemanded(
  inputs: Pick<NeedsInputs, 'largestShowSlots'>,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const slots =
    inputs.largestShowSlots === null
      ? tunableTarget('No active shows', 'aip.needs.defaultSlots', deps.tunables)
      : inputOf(
          `Largest show has ${formatNumber(inputs.largestShowSlots)} slots`,
          inputs.largestShowSlots,
          undefined,
          'count',
        );
  const calc = startCalc('Wrestlers the shows call for', slots, {
    unit: 'count',
    docRef: NEEDS_DOC_REF,
  });
  const perSlot = calc.tunable(deps.tunables, 'aip.needs.workersPerSlot');
  return calc.multiply(`${formatNumber(perSlot)} wrestlers per slot`, perSlot).done();
}

function depthNeeds(
  inputs: NeedsInputs,
  demanded: Traced<number>,
  tunables: EngineTunables,
): FoundNeed[] {
  const needs: FoundNeed[] = [];
  for (const band of NEED_BANDS) {
    const label = PUSH_LABELS[band];
    const targetCalc = startCalc(`Wanted at ${label.toLowerCase()}`, demanded, { unit: 'count' });
    const share = targetCalc.tunable(tunables, BAND_SHARE_KEYS[band]);
    const target = targetCalc
      .multiply(`Share ${formatNumber(share)}`, share)
      .round('round')
      .done();
    const have = inputs.wrestlers.filter(
      (wrestler) => wrestler.available && wrestler.push === band,
    );
    if (target.value <= 0 || have.length >= target.value) {
      continue;
    }
    needs.push({
      key: `depth.${band}`,
      kind: 'depth',
      summary: summaryOf('aip.need.depth', {
        band: label,
        have: have.length,
        target: target.value,
      }),
      severity: shortfallSeverity(
        `${inputs.unitName}: depth at ${label.toLowerCase()}`,
        target,
        have.length,
        `${formatNumber(have.length)} available at ${label.toLowerCase()}`,
      ),
      refs: { personIds: [], titleIds: [] },
    });
  }
  return needs;
}

function alignmentNeed(inputs: NeedsInputs, tunables: EngineTunables): FoundNeed | null {
  const pushed = inputs.wrestlers.filter((wrestler) => wrestler.push !== 'none');
  const faces = pushed.filter((wrestler) => wrestler.alignment === 'face').length;
  const heels = pushed.filter((wrestler) => wrestler.alignment === 'heel').length;
  const gap = Math.abs(faces - heels);
  const allowed = tunables.get('aip.needs.maxAlignmentGap');
  if (gap <= allowed) {
    return null;
  }
  const calc = startCalc(
    `${inputs.unitName}: faces against heels`,
    inputOf(
      `${formatNumber(faces)} faces, ${formatNumber(heels)} heels: a gap of ${formatNumber(gap)}`,
      gap,
      undefined,
      'count',
    ),
    { unit: 'points', docRef: NEEDS_DOC_REF },
  );
  calc.subtract('Gap allowed', calc.tunable(tunables, 'aip.needs.maxAlignmentGap'));
  const perWorker = calc.tunable(tunables, 'aip.needs.alignmentSeverityPerWorker');
  calc.multiply(`${formatNumber(perWorker)} points per worker past it`, perWorker);
  const shortOnHeels = faces > heels;
  return {
    key: 'alignment',
    kind: 'alignment',
    summary: summaryOf(shortOnHeels ? 'aip.need.alignment.heels' : 'aip.need.alignment.faces', {
      faces,
      heels,
    }),
    severity: calc,
    refs: { personIds: [], titleIds: [] },
  };
}

function genderNeeds(inputs: NeedsInputs, tunables: EngineTunables): FoundNeed[] {
  const needs: FoundNeed[] = [];
  const divisions = [...new Set(inputs.genderDivisions)].sort();
  for (const gender of divisions) {
    const division = DIVISION_LABELS[gender];
    const target = tunableTarget(
      `Wanted in the ${division.toLowerCase()}`,
      'aip.needs.minPerGenderDivision',
      tunables,
    );
    const have = inputs.wrestlers.filter(
      (wrestler) => wrestler.available && wrestler.gender === gender,
    ).length;
    if (target.value <= 0 || have >= target.value) {
      continue;
    }
    needs.push({
      key: `gender.${gender}`,
      kind: 'gender',
      summary: summaryOf('aip.need.gender', { division, have, target: target.value }),
      severity: shortfallSeverity(
        `${inputs.unitName}: ${division.toLowerCase()}`,
        target,
        have,
        `${formatNumber(have)} available`,
      ),
      refs: { personIds: [], titleIds: [] },
    });
  }
  return needs;
}

function championNeeds(inputs: NeedsInputs, tunables: EngineTunables): FoundNeed[] {
  const needs: FoundNeed[] = [];
  const endingDays = tunables.get('aip.needs.contractEndingDays');
  for (const champion of inputs.champions) {
    const refs: NeedRefs = { personIds: [...champion.personIds], titleIds: [champion.titleId] };
    const names = champion.names.join(' and ');
    if (!champion.employed) {
      needs.push({
        key: `champion.${champion.titleId}.gone`,
        kind: 'champion',
        summary: summaryOf('aip.need.champion-gone', { title: champion.titleName }),
        severity: severityCalc(`${champion.titleName}: champion has left`).add(
          'Champion has left',
          constantOf(
            'A title with no holder on the roster',
            SEVERITY_MAX,
            'Always the most pressing need',
          ),
        ),
        refs,
      });
      continue;
    }
    if (champion.unfitReason !== null) {
      const calc = severityCalc(`${champion.titleName}: champion cannot defend`);
      needs.push({
        key: `champion.${champion.titleId}.unfit`,
        kind: 'champion',
        summary: summaryOf('aip.need.champion-unfit', {
          title: champion.titleName,
          names,
          reason: champion.unfitReason,
        }),
        severity: calc.add(
          `${names}: ${champion.unfitReason}`,
          calc.tunable(tunables, 'aip.needs.championUnfitSeverity'),
        ),
        refs,
      });
    }
    if (champion.contractEndsOn !== null) {
      const daysLeft = diffDays(inputs.today, champion.contractEndsOn);
      if (daysLeft <= endingDays) {
        const calc = severityCalc(`${champion.titleName}: champion's contract is ending`);
        calc.tunable(tunables, 'aip.needs.contractEndingDays');
        calc.branch(
          `Contract ends in ${formatNumber(daysLeft)} days, within ${formatNumber(endingDays)}`,
          true,
        );
        needs.push({
          key: `champion.${champion.titleId}.ending`,
          kind: 'champion',
          summary: summaryOf('aip.need.champion-ending', {
            title: champion.titleName,
            names,
            date: dateText(champion.contractEndsOn),
          }),
          severity: calc.add(
            'Contract ending',
            calc.tunable(tunables, 'aip.needs.championEndingSeverity'),
          ),
          refs,
        });
      }
    }
  }
  return needs;
}

function crewNeeds(inputs: NeedsInputs, tunables: EngineTunables): FoundNeed[] {
  const needs: FoundNeed[] = [];
  for (const role of NEED_CREW_ROLES) {
    const label = CREW_LABELS[role];
    const target = tunableTarget(`Wanted: ${label}`, CREW_MINIMUM_KEYS[role], tunables);
    const have = inputs.crewCounts[role];
    // A minimum of 0 never makes a need.
    if (target.value <= 0 || have >= target.value) {
      continue;
    }
    needs.push({
      key: `crew.${role}`,
      kind: 'crew',
      summary: summaryOf('aip.need.crew', { role: label, have, target: target.value }),
      severity: shortfallSeverity(
        `${inputs.unitName}: ${label}`,
        target,
        have,
        `${formatNumber(have)} on the roster`,
      ),
      refs: { personIds: [], titleIds: [] },
    });
  }
  return needs;
}

/** Keeps the severity within 0-100 and records the threshold it is checked against. */
function finishNeed(found: FoundNeed, minSeverity: number, tunables: EngineTunables): Need {
  const calc = found.severity.clamp(SEVERITY_MIN, SEVERITY_MAX);
  calc.tunable(tunables, 'aip.needs.minSeverity');
  calc.branch(
    `At least ${formatNumber(minSeverity)}, the least a need must be`,
    calc.current >= minSeverity,
  );
  return { ...found, severity: calc.done() };
}

function compareNeeds(left: Need, right: Need): number {
  return (
    right.severity.value - left.severity.value ||
    (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
  );
}

/**
 * Every need of a roster at or above `aip.needs.minSeverity`, most pressing first (ties by key).
 * See the module comment for the kinds; docs/design/rival-desk.md#needs has the maths.
 */
export function rosterNeeds(inputs: NeedsInputs, deps: { tunables: EngineTunables }): Need[] {
  const { tunables } = deps;
  const demanded = slotsDemanded(inputs, deps);
  const alignment = alignmentNeed(inputs, tunables);
  const found = [
    ...depthNeeds(inputs, demanded, tunables),
    ...(alignment === null ? [] : [alignment]),
    ...genderNeeds(inputs, tunables),
    ...championNeeds(inputs, tunables),
    ...crewNeeds(inputs, tunables),
  ];
  const minSeverity = tunables.get('aip.needs.minSeverity');
  return found
    .map((found) => finishNeed(found, minSeverity, tunables))
    .filter((need) => need.severity.value >= minSeverity)
    .sort(compareNeeds);
}

/**
 * The weekly roster review's Why?: every need considered with its severity, and the most pressing
 * one chosen ('none' when there are none).
 */
export function rosterReviewDecision(needs: readonly Need[]): Traced<string> {
  const decision = startDecision<string>(ROSTER_REVIEW_LABEL, { docRef: NEEDS_DOC_REF });
  const sorted = [...needs].sort(compareNeeds);
  for (const need of sorted) {
    decision.consider(need.key, need.severity, needSummaryText(need.summary));
  }
  const top = sorted[0];
  return top === undefined
    ? decision.choose('none', NO_NEEDS_REASON)
    : decision.choose(top.key, TOP_NEED_REASON);
}
