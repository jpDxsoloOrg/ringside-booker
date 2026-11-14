/**
 * `angle-beats` (MTCH5): the beat catalog fits the angle types, and every stored angle's beats fit
 * the catalog.
 *
 * Runs the engine's `checkBeatCatalog` and `checkSegmentBeats` with the catalogs the merged packs
 * build (`packs.catalogsFromRecords`) laid over the world's own snapshot:
 *
 * - every angle type's `defaultBeatKey` names a beat and is in its `beatKeys` (error, on the angle
 *   type record);
 * - every key in an angle type's `beatKeys` names a beat (error, on the record);
 * - every stored angle beat's `beatKey` names a beat its angle type allows, its people are
 *   participants of the segment, each group (split by participant side) is within the group's
 *   `minPeople..maxPeople`, and a required second group has someone in it (error, on the segment,
 *   located in the last pack loaded).
 *
 * A world whose packs define no beats is not checked, the same way the engine skips a catalog the
 * world does not hold.
 */

import {
  checkBeatCatalog,
  checkSegmentBeats,
  packs,
  type BeatCatalogIssue,
  type GameWorldView,
  type IntegrityIssue,
  type MergedContent,
} from '@ringside/engine';
import { validationError, type ValidationIssue } from '../issues';
import { recordIssue, type ContentRule } from './helpers';

const RULE = 'angle-beats';

function segmentIssue(issue: IntegrityIssue, packId: string): ValidationIssue {
  return validationError({
    code: RULE,
    packId,
    path: [
      issue.table,
      ...(issue.id === undefined ? [] : [issue.id]),
      ...(issue.path === undefined ? [] : issue.path.split('.')),
    ],
    message: `${issue.code}: ${issue.message}`,
  });
}

/** `beatKeys[2]` → `['beatKeys', 2]`. */
function pathSteps(path: string): (string | number)[] {
  return path
    .split(/[.[\]]/)
    .filter((step) => step !== '')
    .map((step) => (/^\d+$/.test(step) ? Number(step) : step));
}

function catalogIssue(content: MergedContent, issue: BeatCatalogIssue): ValidationIssue {
  const prefix = `${packs.ANGLE_TYPE_CONTENT_PREFIX}.`;
  const key = issue.key.startsWith(prefix) ? issue.key.slice(prefix.length) : issue.key;
  const merged = content.records.angleType.get(key);
  const message = `${issue.code}: ${issue.message}`;
  if (merged !== undefined) {
    return recordIssue('error', RULE, 'angleType', key, merged, pathSteps(issue.path), message);
  }
  return validationError({
    code: RULE,
    packId: content.packs.at(-1)?.id ?? '',
    path: [issue.key, ...pathSteps(issue.path)],
    message,
  });
}

export const angleBeats: ContentRule = {
  id: RULE,
  description:
    "Every angle type's default beat and beat list name beats, and every stored angle beat is allowed, cast from the segment's participants and fills its groups",
  check(world: GameWorldView, content: MergedContent) {
    const catalogs = { ...world.meta.catalogs, ...packs.catalogsFromRecords(content.records) };
    const view: GameWorldView = { ...world, meta: { ...world.meta, catalogs } };
    const packId = content.packs.at(-1)?.id ?? '';
    return [
      ...checkBeatCatalog(catalogs).map((issue) => catalogIssue(content, issue)),
      ...checkSegmentBeats(view).map((issue) => segmentIssue(issue, packId)),
    ];
  },
};
