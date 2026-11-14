import type {
  EmploymentRole,
  Reason,
  StorylineCoolingView,
  StorylineEndingView,
} from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { formatNumber } from '@/components/format';

/** The engine host's code for "no game loaded" (`NO_WORLD_REASON`). */
const NO_WORLD_CODE = 'noWorld';

/** What the Storylines screens say when no game answers: the enter-shell helper, say. */
export const NO_GAME_TITLE = 'No game loaded';
export const NO_GAME_TEXT = 'Start or load a game to see your storylines.';

/** The storyline page's empty timeline. */
export const EMPTY_TIMELINE_TEXT = "No linked segments yet: link this story's segments in Booking";

/** True when the query failed because no game is loaded. */
export function isNoWorldError(error: EngineQueryError | null): boolean {
  return (
    error?.kind === 'rejected' && error.reasons.some((reason) => reason.code === NO_WORLD_CODE)
  );
}

/** A failed query in plain words. */
export function queryErrorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** Refusals in one line, as the engine wrote them. */
export function reasonsText(reasons: readonly Reason[]): string {
  return reasons.map((reason) => reason.message).join(' ');
}

/**
 * How the storyline's heat cools, in a line: "Cools from day 8 without progress (in 8 days)",
 * "Cooling 1 per day, floor 10", "At its floor of 10: it cools no further" or "Heat doesn't cool".
 */
export function coolingText(cooling: StorylineCoolingView): string {
  if (cooling.perDay <= 0) return "Heat doesn't cool.";
  if (cooling.coolingNow) {
    return `Cooling ${formatNumber(cooling.perDay)} per day, floor ${formatNumber(cooling.floor)}.`;
  }
  if (cooling.startsInDays !== null) {
    const days = cooling.startsInDays;
    return `Cools from day ${formatNumber(cooling.graceDays + 1)} without progress (in ${formatNumber(days)} ${days === 1 ? 'day' : 'days'}).`;
  }
  return `At its floor of ${formatNumber(cooling.floor)}: it cools no further.`;
}

/**
 * How a storyline ended, in a few words: "No payoff (needs 4 linked segments)", "Payoff", or, for
 * one that ended in an old save before payoffs existed, "Ended before payoffs". The page's Ending
 * panel draws the full record from `storylines.payoff` (CRTV4-05).
 */
export function endingTitle(ending: StorylineEndingView): string {
  switch (ending.payoff) {
    case 'tooFew':
      return `No payoff (needs ${formatNumber(ending.minSegments)} linked ${ending.minSegments === 1 ? 'segment' : 'segments'})`;
    case 'notAvailable':
      return 'Ended before payoffs';
    case 'paid':
      return 'Payoff';
  }
}

/** Each job in a word, for the member picker's rows. */
export const ROLE_WORDS: Readonly<Record<EmploymentRole, string>> = {
  wrestler: 'Wrestler',
  manager: 'Manager',
  presenter: 'Presenter',
  announcer: 'Announcer',
  referee: 'Referee',
  producer: 'Producer',
  booker: 'Booker',
};
