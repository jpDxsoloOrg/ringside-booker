/**
 * Rival rules: the shortcuts computer-run promotions take that the player does not (D-01).
 *
 * Each shortcut is its own named tunable that defaults on. Nothing reads these keys directly:
 * every system asks `aiShortcut` (`aiShortcut.ts`), which turns a shortcut off for a promotion
 * the player runs and for everyone under the "Level playing field" setting. See
 * docs/design/rival-desk.md#shortcuts.
 */

import { defineTunables } from '../../core/tunables/define';

const RIVAL_RULES_CATEGORY = 'Rival rules';
const SHORTCUTS_DOC = 'rival-desk.md#shortcuts';

/** The `ai.*` tunables, merged into `aipTunables`. */
export const aiShortcutTunables = defineTunables({
  'ai.skipInMatchInjuries': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_RULES_CATEGORY,
    description:
      "Rivals' matches cause no in-match injuries; their injuries come from daily world events",
    docRef: SHORTCUTS_DOC,
  },
  'ai.skipResultMorale': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_RULES_CATEGORY,
    description:
      "Rival workers' morale does not move with match results; small off-screen morale events instead",
    docRef: SHORTCUTS_DOC,
  },
  'ai.scoreBonus': {
    kind: 'number',
    default: 3,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'points',
    category: RIVAL_RULES_CATEGORY,
    description: 'Points added to every rival segment score',
    docRef: SHORTCUTS_DOC,
  },
  'ai.simpleBookingInputs': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_RULES_CATEGORY,
    description: 'Rival bookings skip production notes and match plans',
    docRef: SHORTCUTS_DOC,
  },
  'ai.skipMediaRequests': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_RULES_CATEGORY,
    description: 'Rivals receive no media requests',
    docRef: SHORTCUTS_DOC,
  },
  'ai.skipWorkerRequests': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_RULES_CATEGORY,
    description: 'Rival workers make no requests of their bosses',
    docRef: SHORTCUTS_DOC,
  },
  // Defined here since ECO4-05 (it was a Contracts tunable in ECO4-01): every shortcut key lives in
  // this list so `aiShortcut` is the only reader. The rule itself: contracts.md#simple-renewals.
  'ai.contracts.simpleRenewals': {
    kind: 'boolean',
    default: true,
    unit: 'flag',
    category: RIVAL_RULES_CATEGORY,
    description:
      'Rival promotions renew contracts by a simple rule until the rival labour market exists',
    docRef: SHORTCUTS_DOC,
  },
});

/** Every shortcut key, in the order the rules panel lists them. */
export const AI_SHORTCUT_KEYS = [
  'ai.skipInMatchInjuries',
  'ai.skipResultMorale',
  'ai.scoreBonus',
  'ai.simpleBookingInputs',
  'ai.skipMediaRequests',
  'ai.skipWorkerRequests',
  'ai.contracts.simpleRenewals',
] as const satisfies readonly (keyof typeof aiShortcutTunables)[];

/** One shortcut's tunable key. */
export type AiShortcutKey = (typeof AI_SHORTCUT_KEYS)[number];

/** The shortcut keys that are on/off switches: every key but the score bonus. */
export type AiShortcutFlagKey = Exclude<AiShortcutKey, 'ai.scoreBonus'>;

/** What a shortcut reads as: `boolean` for a switch, `number` (points) for the score bonus. */
export type AiShortcutValue<K extends AiShortcutKey> = K extends AiShortcutFlagKey
  ? boolean
  : number;

/** True for the on/off shortcuts, false for the score bonus. */
export function isAiShortcutFlag(key: AiShortcutKey): key is AiShortcutFlagKey {
  return key !== 'ai.scoreBonus';
}

/** How screens name a shortcut. */
export interface AiShortcutInfo {
  /** The shortcut's name, for example "No in-match injuries". */
  readonly label: string;
  /** What happens when it is off (for the player's promotion, or under the level playing field). */
  readonly offText: string;
  /** The feature that acts on it, for "Takes effect when <feature> is in the game". */
  readonly consumer: string;
}

/** Screen text for every shortcut. */
export const AI_SHORTCUTS: Readonly<Record<AiShortcutKey, AiShortcutInfo>> = Object.freeze({
  'ai.skipInMatchInjuries': {
    label: 'No in-match injuries',
    offText: 'Rivals can get hurt in their matches, as your workers can',
    consumer: 'Match injuries (MTCH4)',
  },
  'ai.skipResultMorale': {
    label: 'No morale from results',
    offText: "Rival workers' morale moves with their match results, as your workers' does",
    consumer: 'Worker morale (WRK8)',
  },
  'ai.scoreBonus': {
    label: 'Score bonus',
    offText: 'Rival segments score with no bonus',
    consumer: 'Match ratings (MTCH1)',
  },
  'ai.simpleBookingInputs': {
    label: 'Simpler booking',
    offText: 'Rival bookings use production notes and match plans, as yours do',
    consumer: 'Match ratings (MTCH1)',
  },
  'ai.skipMediaRequests': {
    label: 'No media requests',
    offText: 'Rivals receive media requests, as you do',
    consumer: 'Media requests (SOC1)',
  },
  'ai.skipWorkerRequests': {
    label: 'No worker requests',
    offText: 'Rival workers make requests of their bosses, as yours do',
    consumer: 'Worker requests (SOC5)',
  },
  'ai.contracts.simpleRenewals': {
    label: 'Simple contract renewals',
    offText: 'Rival contracts end when they run out unless contract talks renew them, as yours do',
    consumer: 'Contracts (ECO4)',
  },
});
