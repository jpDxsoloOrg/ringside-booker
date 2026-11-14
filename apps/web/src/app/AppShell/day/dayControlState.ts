import {
  CONTRACTS_ACTION_HINT,
  COUNTER_WAITING_GATE_ID,
  isId,
  NEWS_ACTION_HINT,
  OFFER_ANSWERED_ACTION_HINT,
  RELEASE_REQUESTED_GATE_ID,
} from '@ringside/engine';
import type { GateHit } from '@ringside/engine';
import type { ShowNightRoute } from '@/screens/show-night/useShowNightMode';
import { routes } from '../../routes';

/** What the day control's main button does. */
export type DayPrimaryAction =
  /** Nothing is waiting: advance one day. */
  | { readonly kind: 'next' }
  /**
   * A gate is waiting, so a day would not move. The button names it and goes to the screen that
   * deals with it, or (with no screen to go to) shows the reasons.
   */
  | {
      readonly kind: 'gate';
      readonly label: string;
      /**
       * A shorter label for the phone top bar, where the full one would be cut off, or null when
       * the full one is short enough. The full label stays the button's accessible name.
       */
      readonly phoneLabel: string | null;
      /** The player-facing reason of the gate that decides the button. */
      readonly reason: string;
      /** Where the button goes, or null when no screen deals with this gate. */
      readonly to: string | null;
    }
  /** Days are advancing. */
  | { readonly kind: 'busy' };

export interface DayControlState {
  readonly primary: DayPrimaryAction;
  /** Skip days is offered only when a day can actually move. */
  readonly skipEnabled: boolean;
}

export interface DeriveDayControlOptions {
  /** True while an advance runs, whoever started it. */
  readonly advancing: boolean;
  /**
   * How tonight's show is run (EVT10-02), from `useShowNightRoute`: when it goes live the show
   * night button reads "Go live" (or "Back to the show" part-way through) and opens the show night
   * screen; otherwise it is "Go to the show" into Booking. Left out, the show goes to Booking.
   */
  readonly showNight?: ShowNightRoute;
}

/** How one route hint turns into a button. `count` is how many waiting gates share the hint. */
interface GateRoute {
  readonly label: (count: number) => string;
  /** The phone top bar's label, when `label` is too long to fit beside the date (UI-30). */
  readonly phoneLabel?: (count: number) => string;
  readonly to: (hit: GateHit) => string;
}

/** The route hint for the inbox. Its gates outrank every other kind. */
export const INBOX_HINT = 'inbox';

/**
 * The route hint for show night (the engine's `SHOW_NIGHT_ACTION_HINT`): the day stops on a show
 * of yours ("Tonight: <Show>") and the button goes to that show, where you run it (EVT2-09): the
 * show night screen when it goes live (EVT10-02), else Booking.
 */
export const SHOW_NIGHT_HINT = 'showNight';

/** The label of the show night button. */
export const GO_TO_SHOW_LABEL = 'Go to the show';

/** The show night button's label in the phone top bar. */
export const SHOW_TONIGHT_PHONE_LABEL = 'Tonight';

/** The show night button's label when the show goes live (EVT10-02). */
export const GO_LIVE_LABEL = 'Go live';

/** The show night button's label while the show is part-way through (EVT10-02). */
export const BACK_TO_SHOW_LABEL = 'Back to the show';

/** Show night when the show goes live: the show night screen for the gate's show. */
function liveShowRoute(underWay: boolean): GateRoute {
  return {
    label: () => (underWay ? BACK_TO_SHOW_LABEL : GO_LIVE_LABEL),
    ...(underWay ? { phoneLabel: () => SHOW_TONIGHT_PHONE_LABEL } : {}),
    to: (hit) =>
      hit.subject?.kind === 'eventInstance' && isId('eventInstance', hit.subject.id)
        ? routes.game.showNight(hit.subject.id)
        : routes.game.booking(),
  };
}

/**
 * The route hint for the own-injury stop (the engine's `ROSTER_ACTION_HINT`, WRK6-04): one of your
 * workers was hurt, and the button goes where the injury is shown, which marks it as seen.
 */
export const ROSTER_HINT = 'roster';

/** The label of the own-injury button. */
export const ROSTER_LABEL = 'Roster';

/** The `?tab=` of the roster's Injuries tab (WRK6-06). */
export const INJURIES_TAB_ID = 'injuries';

/**
 * True once the roster's Injuries tab is registered (`registerInjuriesTab.ts` flips it). This file
 * never imports the roster screen, so the button works whether or not that tab exists: without it
 * the button opens the injured worker's Health tab instead.
 */
let rosterInjuriesTabAvailable = false;

/** Tells the day control whether the roster has an Injuries tab to send the own-injury stop to. */
export function setRosterInjuriesTabAvailable(available: boolean): void {
  rosterInjuriesTabAvailable = available;
}

/**
 * Where the own-injury button goes: the roster's Injuries tab when it exists, else the injured
 * worker's Health tab, else (a gate with no person) everyone injured on the Workers list. Each of
 * these marks the player's waiting injuries as seen when it opens, which clears the stop.
 */
export function injuryGateDestination(hit: GateHit): string {
  if (rosterInjuriesTabAvailable) return `${routes.game.roster()}?tab=${INJURIES_TAB_ID}`;
  const personId = hit.subject?.kind === 'person' ? hit.subject.id : null;
  if (isId('person', personId)) return `${routes.game.worker(personId)}?tab=health`;
  return `${routes.game.workers()}?availability=injured`;
}

/**
 * The route hint for the contract stops (the engine's `CONTRACTS_ACTION_HINT`, ECO4-04): a contract
 * of yours is about to end (`contracts.expiringSoon`), or a worker wants to leave
 * (`contracts.releaseRequested`). The button goes to the Contracts screen, where one more tap
 * clears the stop.
 */
export const CONTRACTS_HINT: string = CONTRACTS_ACTION_HINT;

/** The label of the contract stops' button. */
export const CONTRACTS_LABEL = 'Contracts';

/**
 * Where a contract stop's button goes. A release request opens that worker's contract on the
 * Active tab, filtered to the workers who want to leave, where Grant or Refuse answers it. An
 * expiring contract opens the Expiring tab, whose Mark all seen clears every waiting notice at once
 * (one notice per tap would mean one stop per contract on a long skip). A waiting counter-offer
 * (ECO5-06) opens those talks on the Offers tab, where Accept counter, Send revised offer or End
 * talks answers it.
 */
export function contractsGateDestination(hit: GateHit): string {
  if (hit.gateId === COUNTER_WAITING_GATE_ID) {
    const negotiationId = hit.subject?.kind === 'negotiation' ? hit.subject.id : null;
    const params = new URLSearchParams({ tab: 'offers' });
    if (isId('negotiation', negotiationId)) params.set('negotiation', negotiationId);
    return `${routes.game.contracts()}?${params.toString()}`;
  }
  const employmentId = hit.subject?.kind === 'employment' ? hit.subject.id : null;
  if (hit.gateId === RELEASE_REQUESTED_GATE_ID) {
    const params = new URLSearchParams({ tab: 'active', wantsToLeave: '1' });
    if (isId('employment', employmentId)) params.set('employment', employmentId);
    return `${routes.game.contracts()}?${params.toString()}`;
  }
  return `${routes.game.contracts()}?tab=expiring`;
}

/**
 * The route hint for the "Offer answered" stop (the engine's `OFFER_ANSWERED_ACTION_HINT`,
 * ECO5-10): a worker signed, turned down or walked away from one of your offers while the days
 * ran. The button opens those talks on Contracts › Offers; the Negotiation Sheet marks the answer
 * as seen when it opens (`contracts.markOffersSeen`), which clears the stop. Several answers stop
 * one at a time.
 */
export const OFFER_ANSWERED_HINT: string = OFFER_ANSWERED_ACTION_HINT;

/** The label of the "Offer answered" button. */
export const OFFER_ANSWERED_LABEL = 'Offer answered';

/** Where the "Offer answered" button goes: the answered talks, open on Contracts › Offers. */
export function offerAnsweredGateDestination(hit: GateHit): string {
  const negotiationId = hit.subject?.kind === 'negotiation' ? hit.subject.id : null;
  const params = new URLSearchParams({ tab: 'offers' });
  if (isId('negotiation', negotiationId)) params.set('negotiation', negotiationId);
  return `${routes.game.contracts()}?${params.toString()}`;
}

/**
 * The route hint for a news alert (the engine's `NEWS_ACTION_HINT`, DAY1-03): a story matched one
 * of the player's alert rules. The button opens the story on the News screen with `alert=1`, and
 * the screen acknowledges the alert (`news.ackAlerts`), which clears the stop (DAY1-05).
 */
export const NEWS_HINT: string = NEWS_ACTION_HINT;

/** The label of the news alert button. */
export const OPEN_NEWS_LABEL = 'Open news';

/** Where a news alert's button goes: the story, flagged as opened from the alert. */
export function newsGateDestination(hit: GateHit): string {
  return hit.subject?.kind === 'news'
    ? `${routes.game.news()}?story=${encodeURIComponent(hit.subject.id)}&alert=1`
    : routes.game.news();
}

/** The label of a gate whose hint no screen handles yet. */
export const GENERIC_GATE_LABEL = 'Needs attention';

/**
 * The route hints the button knows. A hint missing from this map still gets a button
 * ({@link GENERIC_GATE_LABEL}, with the gate's own reason), so a gate added by a later system
 * works before anything here changes.
 */
const GATE_ROUTES: Readonly<Record<string, GateRoute>> = {
  [INBOX_HINT]: {
    label: (count) => `${String(count)} ${count === 1 ? 'decision' : 'decisions'} waiting`,
    phoneLabel: (count) => `${String(count)} waiting`,
    to: () => `${routes.game.inbox()}?filter=decisions`,
  },
  [SHOW_NIGHT_HINT]: {
    label: () => GO_TO_SHOW_LABEL,
    phoneLabel: () => SHOW_TONIGHT_PHONE_LABEL,
    to: (hit) =>
      hit.subject?.kind === 'eventInstance'
        ? `${routes.game.booking()}?event=${encodeURIComponent(hit.subject.id)}`
        : routes.game.booking(),
  },
  [ROSTER_HINT]: {
    label: () => ROSTER_LABEL,
    to: injuryGateDestination,
  },
  [CONTRACTS_HINT]: {
    label: () => CONTRACTS_LABEL,
    to: contractsGateDestination,
  },
  [OFFER_ANSWERED_HINT]: {
    label: () => OFFER_ANSWERED_LABEL,
    to: offerAnsweredGateDestination,
  },
  [NEWS_HINT]: {
    label: () => OPEN_NEWS_LABEL,
    to: newsGateDestination,
  },
};

/**
 * Hints in the order they win when several gates hit at once. Unanswered decisions come before a
 * show: booking with a contract or discipline call still open means acting on stale information.
 * A new injury comes after both: the show screen shows who is hurt anyway. Contract stops come
 * next: they wait days, not hours, and a counter-offer lapses if nobody answers it. An answered
 * offer follows them: it is news about your roster that needs no answer, but more yours than a
 * story. A news alert comes last of all: a show or a decision needs the player more than a story
 * does. Hints not listed here keep the engine's registration order, after these.
 */
const HINT_PRIORITY: readonly string[] = [
  INBOX_HINT,
  SHOW_NIGHT_HINT,
  ROSTER_HINT,
  CONTRACTS_HINT,
  OFFER_ANSWERED_HINT,
  NEWS_HINT,
];

function hintRank(hit: GateHit): number {
  const rank = hit.actionHint === undefined ? -1 : HINT_PRIORITY.indexOf(hit.actionHint);
  return rank === -1 ? HINT_PRIORITY.length : rank;
}

/** The gate that decides the button: the best-ranked hint, then registration order. */
export function leadingGate(gates: readonly GateHit[]): GateHit | undefined {
  let leading: GateHit | undefined;
  for (const hit of gates) {
    if (leading === undefined || hintRank(hit) < hintRank(leading)) leading = hit;
  }
  return leading;
}

function routeFor(hit: GateHit, showNight?: ShowNightRoute): GateRoute | undefined {
  if (hit.actionHint === undefined || !Object.hasOwn(GATE_ROUTES, hit.actionHint)) return undefined;
  if (hit.actionHint === SHOW_NIGHT_HINT && showNight?.goesLive === true) {
    return liveShowRoute(showNight.underWay);
  }
  return GATE_ROUTES[hit.actionHint];
}

/** Where a gate's button goes and what it says, or null when no screen deals with the gate. */
export function gateDestination(
  hit: GateHit,
  gates: readonly GateHit[] = [hit],
  showNight?: ShowNightRoute,
): { readonly label: string; readonly to: string } | null {
  const route = routeFor(hit, showNight);
  if (route === undefined) return null;
  const sameHint = gates.filter((other) => other.actionHint === hit.actionHint).length;
  return { label: route.label(Math.max(sameHint, 1)), to: route.to(hit) };
}

/**
 * The day control's state from the gates waiting today. Pure: the same gates and flag always give
 * the same buttons.
 *
 * - An advance running: the button is busy and Skip is off.
 * - No gates: "Next day", and Skip is on.
 * - Gates: the leading gate's label and destination, and Skip is off, because a skip would stop
 *   before simulating a single day.
 */
export function deriveDayControl(
  gates: readonly GateHit[],
  { advancing, showNight }: DeriveDayControlOptions,
): DayControlState {
  if (advancing) return { primary: { kind: 'busy' }, skipEnabled: false };
  const leading = leadingGate(gates);
  if (leading === undefined) return { primary: { kind: 'next' }, skipEnabled: true };

  const route = routeFor(leading, showNight);
  if (route === undefined) {
    return {
      primary: {
        kind: 'gate',
        label: GENERIC_GATE_LABEL,
        phoneLabel: null,
        reason: leading.reason,
        to: null,
      },
      skipEnabled: false,
    };
  }
  const sameHint = gates.filter((hit) => hit.actionHint === leading.actionHint).length;
  return {
    primary: {
      kind: 'gate',
      label: route.label(sameHint),
      phoneLabel: route.phoneLabel?.(sameHint) ?? null,
      reason: leading.reason,
      to: route.to(leading),
    },
    skipEnabled: false,
  };
}
