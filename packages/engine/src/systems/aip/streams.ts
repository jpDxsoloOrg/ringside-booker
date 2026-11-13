/**
 * The rival desk's random streams. None yet: each rival job declares its own stream here when it
 * lands (for example `aip.rosterReview`), so one job's draws never shift another's.
 */

declare module '../../core/rng/streams' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface StreamNames {}
}

export {};
