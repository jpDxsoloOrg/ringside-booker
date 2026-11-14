/**
 * Deal health (ECO8-05): how a deal is doing, from Safe to Cancelling, with the reasons the player
 * reads. It compares the deal's recent viewers with what the network expects and counts the
 * airings it missed.
 *
 * Rules, worst first (the worst one decides the risk; every one that applies is listed):
 *
 * - **Missed airings:** `missedToCancel` or more missed in the last `missedWindow` scheduled
 *   airings is Cancelling (no roll: the network pulls the deal). One short of it, or cancelled
 *   shows still to come that would reach it, is At risk. `missedToCancel` 0 turns this off.
 * - **Low viewers:** not judged during the grace period (fewer than `graceDays` since the deal
 *   started, or fewer than `minAirings` airings). Otherwise the viewers of the last `window` aired
 *   airings over what the network expected for them: below `cancelBelow` is Cancelling (the
 *   network may cancel at each airing, a seeded roll the phase makes), below `warnBelow` At risk.
 * - **Any missed airing**, past or coming, is at least Watch.
 * - Otherwise Safe.
 *
 * No randomness here: the phase rolls the network's patience.
 *
 * Design: docs/design/broadcast.md#deal-health.
 */

import { dayOfMonth, month, weekday, type GameDate } from '../../../core/date';
import { startCalc, startDecision, type Traced } from '../../../core/trace';
import type { AiringStatus } from '../../../model/entities/airing';
import type { EngineTunables } from '../../tunables';
import { DEAL_RISKS, type DealRisk } from '../events';

export const HEALTH_DOC_REF = 'broadcast.md#deal-health';

/** One recent scheduled airing of the deal, as deal health reads it. */
export interface DealHealthAiring {
  readonly airDate: GameDate;
  readonly status: AiringStatus;
  readonly viewers: number;
  readonly expectedViewers: number;
}

/** What deal health reads. */
export interface DealHealthInputs {
  readonly networkName: string;
  readonly reachTier: number;
  /** Days from the deal's `startsOn` to today. */
  readonly daysSinceStart: number;
  /**
   * The deal's newest scheduled airings, newest first: at least `missedWindow` and `window` of
   * them when it has that many (missed airings are counted over the first `missedWindow`, viewers
   * over the first `window` aired ones).
   */
  readonly recent: readonly DealHealthAiring[];
  /** Shows the deal should air that are already cancelled, soonest first. */
  readonly upcomingMissed: readonly GameDate[];
}

/** What made a deal Cancelling, or null when it is not. */
export type DealHealthCause = 'missedAirings' | 'lowViewers';

/** The risk with its Why? and what the phase and the deal screens need beside it. */
export interface DealHealth extends Traced<DealRisk> {
  /** Why the deal is Cancelling, or null when it is not. */
  readonly cause: DealHealthCause | null;
  /** Every reason that applies, worst first; the first is the risk's own reason. */
  readonly reasons: readonly string[];
  /** Viewers over what the network expected, or null when not judged (grace, nothing expected). */
  readonly ratio: Traced<number> | null;
  /** The chance per airing the network cancels while viewers are below the cancel line. */
  readonly cancelChance: number;
}

const WEEKDAY_SHORT_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_SHORT_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** "Mon 18 Jan". */
export function healthDayText(date: GameDate): string {
  const day = WEEKDAY_SHORT_NAMES[weekday(date)];
  const monthName = MONTH_SHORT_NAMES[month(date) - 1] ?? '';
  return `${day} ${String(dayOfMonth(date))} ${monthName}`;
}

/** "48%". */
function percent(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

function severity(risk: DealRisk): number {
  return DEAL_RISKS.indexOf(risk);
}

interface Finding {
  readonly risk: DealRisk;
  readonly text: string;
  readonly cause: DealHealthCause | null;
}

/** "1 missed airing", "3 missed airings". */
function missedText(count: number): string {
  return `${String(count)} missed airing${count === 1 ? '' : 's'}`;
}

/** How the deal is doing. Deterministic: the same inputs always give the same risk and reasons. */
export function dealHealth(
  inputs: DealHealthInputs,
  deps: { readonly tunables: EngineTunables },
): DealHealth {
  const { tunables } = deps;
  const { networkName } = inputs;
  const decision = startDecision<DealRisk>(`How ${networkName} sees the deal`, {
    docRef: HEALTH_DOC_REF,
  });
  const findings: Finding[] = [];

  // (1) Missed airings.
  const missedWindow = decision.tunable(tunables, 'broadcast.health.missedWindow');
  const missedToCancel = decision.tunable(tunables, 'broadcast.health.missedToCancel');
  const considered = inputs.recent.slice(0, missedWindow);
  const missed = considered.filter((airing) => airing.status === 'missed');
  const upcoming = inputs.upcomingMissed;
  if (missedToCancel === 0) {
    decision.note(`${networkName} never pulls a deal for missed airings`);
  } else {
    const pulled = missed.length >= missedToCancel;
    if (!pulled) {
      decision.rule(
        `${missedText(missed.length)} in the last ${String(considered.length)} airings: ${networkName} pulls a deal at ${String(missedToCancel)}`,
        true,
      );
    }
    if (pulled) {
      findings.push({
        risk: 'cancelling',
        text: `${missedText(missed.length)}: ${networkName} is pulling the deal`,
        cause: 'missedAirings',
      });
    } else if (missed.length > 0 && missed.length === missedToCancel - 1) {
      findings.push({
        risk: 'atRisk',
        text: `One more missed airing and ${networkName} cancels`,
        cause: null,
      });
    } else if (upcoming.length > 0 && missed.length + upcoming.length >= missedToCancel) {
      findings.push({
        risk: 'atRisk',
        text: `Cancelled shows coming up would make ${missedText(missed.length + upcoming.length)}: ${networkName} cancels at ${String(missedToCancel)}`,
        cause: null,
      });
    }
  }

  // (2) Low viewers, once the grace period is over.
  const window = decision.tunable(tunables, 'broadcast.health.window');
  const minAirings = decision.tunable(tunables, 'broadcast.health.minAirings');
  const graceDays = decision.tunable(tunables, 'broadcast.health.graceDays');
  const aired = inputs.recent.filter((airing) => airing.status === 'aired');
  const cancelChance = Math.min(
    1,
    tunables.get('broadcast.health.cancelChance') +
      inputs.reachTier * tunables.get('broadcast.health.cancelChancePerTier'),
  );
  let ratio: Traced<number> | null = null;
  if (inputs.daysSinceStart < graceDays) {
    decision.note(
      `The deal is new: ${networkName} gives it ${String(graceDays)} days before judging viewers`,
    );
  } else if (aired.length < minAirings) {
    decision.note(
      `Only ${String(aired.length)} of ${String(minAirings)} airings so far: too early to judge viewers`,
    );
  } else {
    const judged = aired.slice(0, window);
    const viewers = judged.reduce((sum, airing) => sum + airing.viewers, 0);
    const expected = judged.reduce((sum, airing) => sum + airing.expectedViewers, 0);
    if (expected <= 0) {
      decision.note(`${networkName} expected no viewers: nothing to judge`);
    } else {
      ratio = startCalc(`Viewers against what ${networkName} expects`, viewers, {
        unit: 'ratio',
        docRef: HEALTH_DOC_REF,
        startLabel: `Viewers over the last ${String(judged.length)} airings`,
      })
        .divide(`What ${networkName} expected for them`, expected)
        .done();
      decision.include(`Viewers against what ${networkName} expects`, ratio);
      const warnBelow = decision.tunable(tunables, 'broadcast.health.warnBelow');
      const cancelBelow = decision.tunable(tunables, 'broadcast.health.cancelBelow');
      const share = `Viewers are ${percent(ratio.value)} of what ${networkName} expects`;
      if (ratio.value < cancelBelow) {
        decision.tunable(tunables, 'broadcast.health.cancelChance');
        decision.tunable(tunables, 'broadcast.health.cancelChancePerTier');
        findings.push({
          risk: 'cancelling',
          text: `${share}; each airing it may cancel (${percent(cancelChance)})`,
          cause: 'lowViewers',
        });
      } else if (ratio.value < warnBelow) {
        findings.push({
          risk: 'atRisk',
          text: `${share}; below ${percent(cancelBelow)} it may cancel`,
          cause: null,
        });
      } else {
        decision.rule(share, true);
      }
    }
  }

  // (3) Any missed airing, past or coming, is worth watching.
  for (const airing of missed) {
    findings.push({
      risk: 'watch',
      text: `Missed airing: ${healthDayText(airing.airDate)}`,
      cause: null,
    });
  }
  for (const date of upcoming) {
    findings.push({
      risk: 'watch',
      text: `Missed airing coming: ${healthDayText(date)}`,
      cause: null,
    });
  }

  // Worst first; among equals, the order the rules ran (missed airings before viewers).
  const ordered = findings
    .map((finding, index) => ({ finding, index }))
    .sort(
      (left, right) =>
        severity(right.finding.risk) - severity(left.finding.risk) || left.index - right.index,
    )
    .map(({ finding }) => finding);
  for (const finding of ordered) {
    decision.rule(finding.text, false);
  }
  const [worst] = ordered;
  if (worst === undefined) {
    const because =
      ratio === null
        ? `Nothing wrong so far on ${networkName}`
        : `Viewers are ${percent(ratio.value)} of what ${networkName} expects`;
    return {
      ...decision.choose('safe', because),
      cause: null,
      reasons: [because],
      ratio,
      cancelChance,
    };
  }
  return {
    ...decision.choose(worst.risk, worst.text),
    cause: worst.risk === 'cancelling' ? worst.cause : null,
    reasons: ordered.map((finding) => finding.text),
    ratio,
    cancelChance,
  };
}
