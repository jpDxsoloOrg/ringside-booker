/**
 * Deal verdict: would a network sign this deal? A fixed list of named checks, in order, each with
 * a stable refusal code and the reason the player reads (ECO8-03). The first failing check decides
 * the refusal, and every failing check is listed, so the player sees everything to fix at once.
 *
 * There is no randomness: the same inputs always give the same verdict.
 *
 * Design: docs/design/broadcast.md#valuation.
 */

import { startDecision, type Traced } from '../../../core/trace';
import type { DealTimeslot } from '../../../model/entities/deal';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { NetworkKind } from '../../../model/entities/network';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatViewers } from './audience';
import { VALUATION_DOC_REF } from './dealTerms';

/** Every reason a network refuses a deal, in the order the checks run. */
export const DEAL_REFUSAL_CODES = [
  'networkClosed',
  'outsideMarket',
  'houseShow',
  'notPpvShow',
  'alreadyOnNetwork',
  'coverageOverlap',
  'slotTaken',
  'timeslotNotAllowed',
  'cameraTooLow',
  'belowFloor',
  'audienceTooSmall',
  'badLength',
] as const;
export type DealRefusalCode = (typeof DEAL_REFUSAL_CODES)[number];

/** One reason a network refuses, with the text the player reads. */
export interface DealRefusal {
  readonly code: DealRefusalCode;
  readonly message: string;
}

export type DealVerdictValue = 'accept' | 'refuse';

/** The verdict with its Why?, and every failing check (empty on accept). */
export interface DealVerdict extends Traced<DealVerdictValue> {
  readonly refusals: readonly DealRefusal[];
}

/** What the checks read. The valuation builds these from the world. */
export interface DealCheckInputs {
  readonly networkName: string;
  readonly kind: NetworkKind;
  readonly reachTier: number;
  /** The show's name, or "All major shows" for a promotion-wide deal. */
  readonly showName: string;
  readonly importance: EventImportance;
  readonly timeslot: DealTimeslot;
  /** The network is active and not closed today. */
  readonly networkOnAir: boolean;
  /** The network covers at least one region of the promotion's market. */
  readonly inMarket: boolean;
  /** The same show (or the same promotion-wide deal) already has a live deal on this network. */
  readonly alreadyOnNetwork: boolean;
  /** Another network of the same kind already airing this show where this one reaches, or null. */
  readonly overlapNetworkName: string | null;
  /** The show another deal already airs on this network in the same weekday and timeslot, or null. */
  readonly slotTakenBy: string | null;
  /** The promotion's ECO1 reach (0..100), or null when it was not needed (no prime time asked). */
  readonly reach: Traced<number> | null;
  /** The promotion's camera level. */
  readonly camera: number;
  /** Projected viewers (buys on pay-per-view). */
  readonly projected: number;
  /** Projected ÷ what the network expects. */
  readonly ratio: Traced<number>;
  readonly months: number;
  /** True when the Production screen can raise the camera level (ECO7). */
  readonly cameraCanBeRaised: boolean;
}

const MIN_VIEWER_KEYS = {
  tv: 'broadcast.deal.minViewers.tv',
  ppv: 'broadcast.deal.minViewers.ppv',
  streaming: 'broadcast.deal.minViewers.streaming',
} as const satisfies Readonly<Record<NetworkKind, NumberTunableKey>>;

const KIND_NAMES: Readonly<Record<NetworkKind, string>> = {
  tv: 'TV',
  ppv: 'pay-per-view',
  streaming: 'streaming',
};

const TIMESLOT_NAMES: Readonly<Record<DealTimeslot, string>> = {
  daytime: 'Daytime',
  evening: 'Evening',
  primeTime: 'Prime time',
  lateNight: 'Late night',
};

const PPV_IMPORTANCE: readonly EventImportance[] = ['major', 'flagship'];

/** "about 245%", "less than 1%" for a ratio. */
export function percentOf(ratio: number): string {
  const percent = Math.round(ratio * 100);
  if (percent === 0 && ratio > 0) {
    return 'less than 1%';
  }
  return `about ${String(percent)}%`;
}

/** "85%" for a ratio. */
function wholePercent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

/** A reach to one decimal: "9.4". */
function formatReach(reach: number): string {
  return (Math.round(reach * 10) / 10).toFixed(1);
}

function audienceWord(kind: NetworkKind, count: number): string {
  if (kind === 'ppv') {
    return count === 1 ? 'buy' : 'buys';
  }
  return count === 1 ? 'viewer' : 'viewers';
}

interface Check {
  readonly code: DealRefusalCode;
  readonly passed: boolean;
  /** What the Why? says when the check passes. */
  readonly passText: string;
  /** The refusal the player reads when it fails. */
  readonly message: string;
}

function checksFor(inputs: DealCheckInputs, tunables: EngineTunables): Check[] {
  const { networkName, showName, kind } = inputs;
  const isPpv = kind === 'ppv';
  const minReach = tunables.get('broadcast.deal.primeTimeMinReach');
  const cameraNeeded = inputs.reachTier * tunables.get('broadcast.deal.cameraPerTier');
  const floor = tunables.get(MIN_VIEWER_KEYS[kind]);
  const minRatio = tunables.get('broadcast.deal.minBenchmarkRatio');
  const minMonths = tunables.get('broadcast.deal.minMonths');
  const maxMonths = tunables.get('broadcast.deal.maxMonths');
  const primeTimeAsked = !isPpv && inputs.timeslot === 'primeTime';
  const reach = inputs.reach?.value ?? 0;
  const ratio = inputs.ratio.value;
  const lengthOk =
    Number.isInteger(inputs.months) && inputs.months >= minMonths && inputs.months <= maxMonths;
  return [
    {
      code: 'networkClosed',
      passed: inputs.networkOnAir,
      passText: `${networkName} is on the air`,
      message: `${networkName} is off the air`,
    },
    {
      code: 'outsideMarket',
      passed: inputs.inMarket,
      passText: `${networkName} covers places your fans are`,
      message: `${networkName} doesn't cover anywhere your fans are`,
    },
    {
      code: 'houseShow',
      passed: inputs.importance !== 'house',
      passText: `${showName} is not a house show`,
      message: "House shows aren't televised",
    },
    {
      code: 'notPpvShow',
      passed: !isPpv || PPV_IMPORTANCE.includes(inputs.importance),
      passText: isPpv
        ? `${showName} is big enough for pay-per-view`
        : 'Not a pay-per-view deal: any televised show will do',
      message: 'Pay-per-view only carries major and flagship events',
    },
    {
      code: 'alreadyOnNetwork',
      passed: !inputs.alreadyOnNetwork,
      passText: `${showName} isn't on ${networkName} yet`,
      message: `${showName} already airs on ${networkName}`,
    },
    {
      code: 'coverageOverlap',
      passed: inputs.overlapNetworkName === null,
      passText: `${showName} isn't on another ${KIND_NAMES[kind]} network in the same places`,
      message: `${showName} already airs on ${inputs.overlapNetworkName ?? 'another network'} in the same regions`,
    },
    {
      code: 'slotTaken',
      passed: inputs.slotTakenBy === null,
      passText: isPpv
        ? 'Pay-per-view carries every promotion'
        : `${networkName} has that slot free`,
      message: `${networkName} already airs ${inputs.slotTakenBy ?? 'another show'} in that slot`,
    },
    {
      code: 'timeslotNotAllowed',
      passed: !primeTimeAsked || reach >= minReach,
      passText: isPpv
        ? "Pay-per-view isn't tied to a timeslot"
        : primeTimeAsked
          ? `Prime time needs a reach of ${formatReach(minReach)}; yours is ${formatReach(reach)}`
          : `${TIMESLOT_NAMES[inputs.timeslot]} is open to every promotion`,
      message: `Prime time needs a reach of ${formatReach(minReach)}; yours is ${formatReach(reach)}`,
    },
    {
      code: 'cameraTooLow',
      passed: inputs.camera >= cameraNeeded,
      passText: `${networkName} needs camera level ${String(cameraNeeded)}; yours is ${String(inputs.camera)}`,
      message: `${networkName} needs camera level ${String(cameraNeeded)}; yours is ${String(inputs.camera)}${inputs.cameraCanBeRaised ? '. Raise your camera level (Production)' : ''}`,
    },
    {
      code: 'belowFloor',
      passed: inputs.projected >= floor,
      passText: `At least ${formatViewers(floor)} ${audienceWord(kind, floor)}: enough for ${KIND_NAMES[kind]}`,
      message: `Fewer than ${formatViewers(floor)} ${audienceWord(kind, floor)} is too small for ${KIND_NAMES[kind]}`,
    },
    {
      code: 'audienceTooSmall',
      passed: ratio >= minRatio,
      passText: `Your audience would be ${percentOf(ratio)} of what ${networkName} expects; it needs ${wholePercent(minRatio)}`,
      message: `Your audience would be ${percentOf(ratio)} of what ${networkName} needs (${wholePercent(minRatio)})`,
    },
    {
      code: 'badLength',
      passed: lengthOk,
      passText: `${String(inputs.months)} months is within ${String(minMonths)} to ${String(maxMonths)} months`,
      message: `A deal runs ${String(minMonths)} to ${String(maxMonths)} months; ${String(inputs.months)} months is outside that`,
    },
  ];
}

/** Would the network sign? Every check is a rule in the Why?, in order. */
export function dealVerdict(
  inputs: DealCheckInputs,
  deps: { readonly tunables: EngineTunables },
): DealVerdict {
  const { tunables } = deps;
  const decision = startDecision<DealVerdictValue>(`Would ${inputs.networkName} sign?`, {
    docRef: VALUATION_DOC_REF,
  });
  const refusals: DealRefusal[] = [];
  for (const check of checksFor(inputs, tunables)) {
    decision.rule(check.passed ? check.passText : check.message, check.passed);
    if (!check.passed) {
      refusals.push({ code: check.code, message: check.message });
    }
  }
  if (inputs.reach !== null) {
    decision.include('Your reach', inputs.reach);
  }
  decision.include(`Your audience against what ${inputs.networkName} expects`, inputs.ratio);
  decision.tunable(tunables, 'broadcast.deal.minBenchmarkRatio');
  const [first] = refusals;
  const verdict =
    first === undefined
      ? decision.choose('accept', `${inputs.networkName} would sign: every check passed`)
      : decision.choose('refuse', first.message);
  return { ...verdict, refusals };
}
