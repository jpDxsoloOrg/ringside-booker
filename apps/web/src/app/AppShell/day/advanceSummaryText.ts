import type { AdvanceResult, Reason } from '@ringside/engine';
import { formatGameDate, formatNumber } from '@/components/format';

/** The words the summary banner and the announcement share. */
export interface AdvanceSummaryText {
  /** "Advanced 30 days to Friday, March 14, 2031". */
  readonly headline: string;
  /** Why it stopped early, or null when it ran every day asked for. */
  readonly reason: string | null;
  /** "3 background steps failed", or null when none did. */
  readonly failures: string | null;
  /** Everything above as sentences, for the live region. */
  readonly announcement: string;
}

/** "1 day", "30 days", "3,650 days". */
export function dayCount(days: number): string {
  return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;
}

/** Ends `text` with a full stop unless it already ends a sentence. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** Why an advance stopped, in the player's words. */
export function stopReason(stoppedBy: AdvanceResult['stoppedBy']): string | null {
  switch (stoppedBy.kind) {
    case 'gate':
      return stoppedBy.hits[0]?.reason ?? 'Something needs your attention';
    case 'cancelled':
      return 'Stopped by you';
    case 'completed':
      return null;
  }
}

/** "3 background steps failed". */
export function failureCountLabel(count: number): string {
  return `${formatNumber(count)} background ${count === 1 ? 'step' : 'steps'} failed`;
}

/** The summary of a finished advance. */
export function describeAdvance(result: AdvanceResult): AdvanceSummaryText {
  const date = formatGameDate(result.endDate, 'long');
  const headline =
    result.daysAdvanced > 0
      ? `Advanced ${dayCount(result.daysAdvanced)} to ${date}`
      : `Stayed on ${date}`;
  const reason = stopReason(result.stoppedBy);
  const failures = result.failures.length > 0 ? failureCountLabel(result.failures.length) : null;
  const announcement = [headline, reason, failures]
    .filter((part): part is string => part !== null)
    .map(sentence)
    .join(' ');
  return { headline, reason, failures, announcement };
}

/** The summary of an advance the engine would not start. */
export function describeRefusal(reasons: readonly Reason[]): AdvanceSummaryText {
  const headline = "The game couldn't move forward";
  const reason = reasons.map((item) => item.message).join(' ') || null;
  const announcement = [headline, reason]
    .filter((part): part is string => part !== null)
    .map(sentence)
    .join(' ');
  return { headline, reason, failures: null, announcement };
}

/** The failures as plain text for "Copy details": one line per failed step. */
export function failuresToText(failures: AdvanceResult['failures']): string {
  return failures
    .map((failure) => `${failure.date}  ${failure.stepId}  ${failure.message}`)
    .join('\n');
}
