/**
 * The segment finish check (MTCH2): every stored match's planned finish fits the match.
 *
 * For every match segment:
 *
 * - `match.finishKey` is null ("decided on the night") or names a finish (`segments.unknownFinish`);
 * - a named finish is allowed for the match's type and side count (`segments.finishNotAllowed`);
 * - when the match has an `outcome`, its kind is the finish's `outcomeKind`
 *   (`segments.finishOutcomeMismatch`);
 * - a win's `outcome.methodKey` is one of the finish's methods (`segments.methodNotInFinish`).
 *
 * The side count is the number of distinct sides with a competitor. A world without a finish
 * catalog is not checked (a save from before finishes, or a world built without packs). Nothing
 * throws; each problem is an error naming the segment and the field.
 *
 * validate:world runs this as its `segment-finishes` rule. Design: docs/design/match-finishes.md.
 */

import type { IntegrityIssue } from '../../../model/integrity';
import { isMatch, type MatchSegment } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { allowedFinishes } from '../finishes/allowed';

/** Issue codes this check reports. */
export const SEGMENT_FINISH_ISSUE_CODES = {
  unknownFinish: 'segments.unknownFinish',
  finishNotAllowed: 'segments.finishNotAllowed',
  finishOutcomeMismatch: 'segments.finishOutcomeMismatch',
  methodNotInFinish: 'segments.methodNotInFinish',
} as const;

const CODES = SEGMENT_FINISH_ISSUE_CODES;
const TABLE = 'segments';

function issue(
  segment: DeepReadonly<MatchSegment>,
  code: string,
  path: string,
  message: string,
): IntegrityIssue {
  return {
    code,
    table: TABLE,
    id: segment.id,
    path,
    message: `segments ${segment.id}: ${message}`,
  };
}

function sideCountOf(read: GameWorldView, segment: DeepReadonly<MatchSegment>): number {
  const sides = new Set(
    read.tables.participants
      .lookup('bySegment', segment.id)
      .filter((participant) => participant.role === 'competitor')
      .map((participant) => participant.side),
  );
  return sides.size;
}

function checkSegment(read: GameWorldView, segment: DeepReadonly<MatchSegment>): IntegrityIssue[] {
  const { catalogs } = read.meta;
  const finishes = catalogs.finishes ?? {};
  const { finishKey, matchTypeKey, stipulationKeys } = segment.match;
  if (finishKey === null) {
    return [];
  }
  const finish = Object.hasOwn(finishes, finishKey) ? finishes[finishKey] : undefined;
  if (finish === undefined) {
    return [
      issue(
        segment,
        CODES.unknownFinish,
        'match.finishKey',
        `match.finishKey ${finishKey} is not a finish in this world's catalog`,
      ),
    ];
  }
  const issues: IntegrityIssue[] = [];
  const sideCount = sideCountOf(read, segment);
  const allowed = allowedFinishes(catalogs, {
    matchTypeKey,
    ...(sideCount >= 2 ? { sideCount } : {}),
    stipulationKeys,
  });
  if (!allowed.some((entry) => entry.key === finishKey)) {
    issues.push(
      issue(
        segment,
        CODES.finishNotAllowed,
        'match.finishKey',
        `finish ${finishKey} is not allowed for a ${matchTypeKey} match with ${String(sideCount)} sides`,
      ),
    );
  }
  const { outcome } = segment;
  if (outcome === null) {
    return issues;
  }
  if (outcome.kind !== finish.outcomeKind) {
    issues.push(
      issue(
        segment,
        CODES.finishOutcomeMismatch,
        'outcome.kind',
        `outcome is a ${outcome.kind} but finish ${finishKey} ends in a ${finish.outcomeKind}`,
      ),
    );
    return issues;
  }
  if (
    outcome.kind === 'win' &&
    !finish.methods.some((method) => method.methodKey === outcome.methodKey)
  ) {
    issues.push(
      issue(
        segment,
        CODES.methodNotInFinish,
        'outcome.methodKey',
        `method ${outcome.methodKey} is not one of finish ${finishKey}'s methods`,
      ),
    );
  }
  return issues;
}

/**
 * Every problem with a stored match's planned finish, in segment ID order. Empty when the world
 * holds no finish catalog.
 */
export function checkSegmentFinishes(read: GameWorldView): IntegrityIssue[] {
  if (read.meta.catalogs.finishes === undefined) {
    return [];
  }
  // values() lists rows in ID order.
  return read.tables.segments
    .values()
    .flatMap((segment) => (isMatch(segment) ? checkSegment(read, segment) : []));
}
