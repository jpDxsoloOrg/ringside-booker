/**
 * The one-call pack loader: resolve, merge, check and materialise.
 *
 * The loader never touches the file system or the DOM. Callers (the web worker, the tools) read
 * and parse the JSON themselves and hand it over as `RawPack`s.
 *
 * Format doc: docs/design/data-packs.md, "Loading".
 */

import type { GameDate } from '../../core/date';
import type { WorldSettings } from '../../model/world-meta';
import type { RawPack } from './index';
import { packError, type PackIssue, type Result } from './issues';
import { buildContentLibrary, type ContentLibrary } from './library';
import { materialiseWorld, type MaterialisedWorld } from './materialise';
import { mergeRecords } from './merge';
import { resolvePacks } from './resolve';

export interface LoadWorldOptions {
  /** The game seed. */
  readonly seed: string;
  /** The first day of the game; defaults to the `startDate` of the last world pack loaded. */
  readonly startDate?: GameDate;
  /** New-game settings; anything left out takes `DEFAULT_WORLD_SETTINGS`. */
  readonly settings?: Partial<WorldSettings>;
  /** The world's name; defaults to the last world pack's name. */
  readonly worldName?: string;
}

/** A loaded world, its RNG registry and the content library the generators read. */
export interface LoadedWorld extends MaterialisedWorld {
  readonly library: ContentLibrary;
}

/**
 * Loads a World from packs: `resolvePacks` from `rootIds`, `mergeRecords`, then
 * `materialiseWorld`. Stops at the first step that finds an error and returns every issue found so
 * far; warnings come back with the world on success.
 */
export function loadWorldFromPacks(
  packs: readonly RawPack[],
  rootIds: readonly string[],
  opts: LoadWorldOptions,
): Result<LoadedWorld> {
  const resolved = resolvePacks(packs, rootIds);
  if (!resolved.ok) {
    return resolved;
  }
  const merged = mergeRecords(resolved.value);
  const warnings: PackIssue[] = [...resolved.issues, ...merged.issues];
  if (!merged.ok) {
    return { ok: false, issues: warnings };
  }
  const startDate = opts.startDate ?? merged.value.startDate;
  if (startDate === null) {
    const lastPackId = merged.value.packs.at(-1)?.id ?? rootIds[0] ?? '';
    return {
      ok: false,
      issues: [
        ...warnings,
        packError({
          code: 'missing-start-date',
          packId: lastPackId,
          path: ['startDate'],
          message: 'No start date was given and none of the loaded packs is a world pack',
        }),
      ],
    };
  }
  const materialised = materialiseWorld(merged.value, {
    seed: opts.seed,
    startDate,
    ...(opts.settings === undefined ? {} : { settings: opts.settings }),
    ...(opts.worldName === undefined ? {} : { worldName: opts.worldName }),
  });
  const issues = [...warnings, ...materialised.issues];
  if (!materialised.ok) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: { ...materialised.value, library: buildContentLibrary(merged.value) },
    issues,
  };
}
