/**
 * Telling "made with an older build" apart from a real load bug.
 *
 * While save format v1 is unfrozen, a build that changes a schema edits v1 in place, so a save
 * from an earlier build can fail to load. Every save carries the schema fingerprint of the build
 * that wrote it. A load that fails while checking the data, and whose fingerprint differs from
 * this build's, was made with an older build; a failure with the same fingerprint is a bug and
 * keeps its detailed report. Pure: no simulation imports.
 *
 * See docs/design/save-format.md, "Older builds (until the format freezes)".
 */

import type { LoadStage } from './report';

/** The load stages at which a schema change shows up. */
export const COMPAT_GUARDED_STAGES = ['validate', 'build', 'integrity'] as const;

export type CompatGuardedStage = (typeof COMPAT_GUARDED_STAGES)[number];

/** Why a save could not be opened, when the reason is the build it was made with. */
export interface SaveCompat {
  readonly kind: 'olderBuild';
  /** The fingerprint in the save's header, or null for a save from before fingerprints. */
  readonly savedFingerprint: string | null;
  readonly currentFingerprint: string;
}

export interface LoadFailureFacts {
  /** Where the load stopped. A stage outside the engine's own (such as storage) never classifies. */
  readonly stage: LoadStage | 'storage';
  readonly savedFingerprint: string | null;
  readonly currentFingerprint: string;
}

function isGuardedStage(stage: string): stage is CompatGuardedStage {
  return COMPAT_GUARDED_STAGES.some((guarded) => guarded === stage);
}

/**
 * `olderBuild` when the load stopped at a guarded stage and the save's fingerprint is not this
 * build's (a missing fingerprint counts as different); otherwise null. Failures at the decode,
 * parse, format, version and migrate stages are never reclassified, so a save from a newer build
 * keeps its own message.
 */
export function classifyLoadFailure(facts: LoadFailureFacts): SaveCompat | null {
  if (!isGuardedStage(facts.stage) || facts.savedFingerprint === facts.currentFingerprint) {
    return null;
  }
  return {
    kind: 'olderBuild',
    savedFingerprint: facts.savedFingerprint,
    currentFingerprint: facts.currentFingerprint,
  };
}
