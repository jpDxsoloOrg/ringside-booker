/**
 * The stats a beat group is scored on (MTCH5).
 *
 * Seven are person attributes (`people.attributes`). `popularity` is the person's popularity in
 * the region the show is in (`regionalPop` there, D-03), never their best region anywhere: a star
 * abroad is not a star here.
 *
 * A manager may stand in for a group only on the talking stats, mic and charisma.
 *
 * This file imports nothing, so the catalog schemas in `model/catalogs.ts` can read it.
 * Design: docs/design/angle-rating.md, "Beat catalog".
 */

/** Every stat a beat group may name. */
export const BEAT_STATS = [
  'mic',
  'charisma',
  'presence',
  'athleticism',
  'ringwork',
  'psychology',
  'broadcasting',
  'popularity',
] as const;

export type BeatStat = (typeof BEAT_STATS)[number];

/** The only stats a manager may stand in for. */
export const TALKING_STATS = ['mic', 'charisma'] as const satisfies readonly BeatStat[];

export type TalkingStat = (typeof TALKING_STATS)[number];

/** Player-facing labels. */
export const BEAT_STAT_LABELS: Readonly<Record<BeatStat, string>> = {
  mic: 'Mic',
  charisma: 'Charisma',
  presence: 'Presence',
  athleticism: 'Athleticism',
  ringwork: 'Ring work',
  psychology: 'Psychology',
  broadcasting: 'Broadcasting',
  popularity: 'Popularity here',
};

/** True when `value` is a beat stat. */
export function isBeatStat(value: unknown): value is BeatStat {
  return BEAT_STATS.some((stat) => stat === value);
}

/** True when a manager may stand in for `stat`. */
export function isTalkingStat(stat: BeatStat): stat is TalkingStat {
  return TALKING_STATS.some((talking) => talking === stat);
}
