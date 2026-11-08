/**
 * Phase groups: the coarse order of a day.
 *
 * Every phase belongs to one group, and a group's numeric base fixes where it runs in the day.
 * Within a group, a phase's `order` (0 to 99) fixes its place, so the full position of a phase is
 * `base + order` and never depends on which system registered first. `open` and `close` are the
 * engine's own steps (start the day, then move the clock); systems cannot register into them.
 *
 * See the "Groups" section of docs/design/day-pipeline.md.
 */

/** Every group name, in day order. */
export const PHASE_GROUPS = Object.freeze([
  'open',
  'housekeeping',
  'worldEvents',
  'aiTurns',
  'contracts',
  'shows',
  'settlement',
  'growth',
  'money',
  'periodic',
  'close',
] as const);

/** A phase group name. */
export type PhaseGroup = (typeof PHASE_GROUPS)[number];

/** Each group's numeric base. Bases rise in the order of {@link PHASE_GROUPS}, 100 apart. */
export const PHASE_GROUP_BASES: Readonly<Record<PhaseGroup, number>> = Object.freeze({
  open: 0,
  housekeeping: 100,
  worldEvents: 200,
  aiTurns: 300,
  contracts: 400,
  shows: 500,
  settlement: 600,
  growth: 700,
  money: 800,
  periodic: 900,
  close: 1000,
});

/** The groups only the engine's built-in steps use. */
export const ENGINE_ONLY_GROUPS: readonly PhaseGroup[] = Object.freeze(['open', 'close']);

/** The groups systems register their phases into. */
export type SystemPhaseGroup = Exclude<PhaseGroup, 'open' | 'close'>;

/** The highest `order` a phase may have within its group. */
export const MAX_PHASE_ORDER = 99;

/** True when `value` names a phase group. */
export function isPhaseGroup(value: unknown): value is PhaseGroup {
  return PHASE_GROUPS.some((group) => group === value);
}

/** True when the group is reserved for the engine's built-in steps. */
export function isEngineOnlyGroup(group: PhaseGroup): boolean {
  return ENGINE_ONLY_GROUPS.includes(group);
}

/** Where a phase sits in the day: its group's base plus its order within the group. */
export function phasePosition(group: PhaseGroup, order: number): number {
  return PHASE_GROUP_BASES[group] + order;
}
