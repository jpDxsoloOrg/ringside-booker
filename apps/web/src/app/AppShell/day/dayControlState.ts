import type { GateHit } from '@ringside/engine';
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
 * of yours ("Tonight: <Show>") and the button goes to that show, where you run it (EVT2-09).
 */
export const SHOW_NIGHT_HINT = 'showNight';

/** The label of the show night button. */
export const GO_TO_SHOW_LABEL = 'Go to the show';

/** The show night button's label in the phone top bar. */
export const SHOW_TONIGHT_PHONE_LABEL = 'Show tonight';

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
};

/**
 * Hints in the order they win when several gates hit at once. Unanswered decisions come before a
 * show: booking with a contract or discipline call still open means acting on stale information.
 * Hints not listed here keep the engine's registration order, after these.
 */
const HINT_PRIORITY: readonly string[] = [INBOX_HINT, SHOW_NIGHT_HINT];

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

function routeFor(hit: GateHit): GateRoute | undefined {
  if (hit.actionHint === undefined || !Object.hasOwn(GATE_ROUTES, hit.actionHint)) return undefined;
  return GATE_ROUTES[hit.actionHint];
}

/** Where a gate's button goes and what it says, or null when no screen deals with the gate. */
export function gateDestination(
  hit: GateHit,
  gates: readonly GateHit[] = [hit],
): { readonly label: string; readonly to: string } | null {
  const route = routeFor(hit);
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
  { advancing }: DeriveDayControlOptions,
): DayControlState {
  if (advancing) return { primary: { kind: 'busy' }, skipEnabled: false };
  const leading = leadingGate(gates);
  if (leading === undefined) return { primary: { kind: 'next' }, skipEnabled: true };

  const route = routeFor(leading);
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
