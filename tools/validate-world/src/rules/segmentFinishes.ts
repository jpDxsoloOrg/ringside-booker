/**
 * `segment-finishes` (MTCH2): every stored match's planned finish fits the match.
 *
 * Runs the engine's `checkSegmentFinishes` on the loaded world, with the catalogs the merged packs
 * build (`packs.catalogsFromRecords`) laid over the world's own snapshot:
 *
 * - `match.finishKey` is null or names a finish (`segments.unknownFinish`);
 * - the finish is allowed for the match's type and side count (`segments.finishNotAllowed`);
 * - a set `outcome` has the finish's outcome kind (`segments.finishOutcomeMismatch`);
 * - a win's method is one of the finish's methods (`segments.methodNotInFinish`).
 *
 * Each problem is an error naming the segment and the field, located in the last pack loaded
 * (segments have no record). The engine's code leads the message. A world with no finish catalog
 * is not checked.
 */

import {
  checkSegmentFinishes,
  packs,
  type GameWorldView,
  type IntegrityIssue,
  type MergedContent,
} from '@ringside/engine';
import { validationError, type ValidationIssue } from '../issues';
import type { ContentRule } from './helpers';

function segmentIssue(issue: IntegrityIssue, packId: string): ValidationIssue {
  return validationError({
    code: 'segment-finishes',
    packId,
    path: [
      issue.table,
      ...(issue.id === undefined ? [] : [issue.id]),
      ...(issue.path === undefined ? [] : issue.path.split('.')),
    ],
    message: `${issue.code}: ${issue.message}`,
  });
}

export const segmentFinishes: ContentRule = {
  id: 'segment-finishes',
  description:
    "Every stored match's planned finish names a finish, is allowed for the match type and side count, and agrees with the outcome and its method",
  check(world: GameWorldView, content: MergedContent) {
    const catalogs = { ...world.meta.catalogs, ...packs.catalogsFromRecords(content.records) };
    const view: GameWorldView = { ...world, meta: { ...world.meta, catalogs } };
    const packId = content.packs.at(-1)?.id ?? '';
    return checkSegmentFinishes(view).map((issue) => segmentIssue(issue, packId));
  },
};
