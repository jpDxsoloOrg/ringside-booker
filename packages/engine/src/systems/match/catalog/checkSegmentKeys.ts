/**
 * The segment key check: every catalog key a stored segment holds names an entry in the world's
 * catalogs (`WorldMeta.catalogs`).
 *
 * - a match's `match.matchTypeKey` must be a match type;
 * - a win's `outcome.methodKey` must be a method;
 * - an angle's `angle.angleTypeKey` must be an angle type.
 *
 * Each problem is an error naming the segment and the field path; nothing throws. A catalog the
 * world does not hold is not checked (a world built without packs has none, and still loads).
 *
 * `match.finishKey` is checked by `checkSegmentFinishes` (MTCH2), next to this file. Not checked
 * yet, because their catalogs do not exist: `angle.beats[].beatKey` (MTCH5 adds the beat catalog)
 * and `match.stipulationKeys` (MTCH7 adds stipulations). Each of those features adds its check
 * here.
 *
 * validate:world runs this as part of its `segment-keys` rule.
 */

import { angleTypeOf, matchTypeOf, methodOf, type CatalogReader } from '../../../model/catalogs';
import type { IntegrityIssue } from '../../../model/integrity';
import { isMatch, type Segment } from '../../../model/entities/segment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';

/** Issue codes this check reports. */
export const SEGMENT_KEY_ISSUE_CODES = {
  matchType: 'segments.unknownMatchType',
  method: 'segments.unknownMethod',
  angleType: 'segments.unknownAngleType',
} as const;

const TABLE = 'segments';

function unknownKey(
  segment: DeepReadonly<Segment>,
  code: string,
  path: string,
  key: string,
  what: string,
): IntegrityIssue {
  return {
    code,
    table: TABLE,
    id: segment.id,
    path,
    message: `segments ${segment.id}: ${path} ${key} is not a ${what} in this world's catalog`,
  };
}

function checkSegment(read: CatalogReader, segment: DeepReadonly<Segment>): IntegrityIssue[] {
  const { catalogs } = read.meta;
  const issues: IntegrityIssue[] = [];
  if (isMatch(segment)) {
    const { matchTypeKey } = segment.match;
    if (catalogs.matchTypes !== undefined && matchTypeOf(read, matchTypeKey) === undefined) {
      issues.push(
        unknownKey(
          segment,
          SEGMENT_KEY_ISSUE_CODES.matchType,
          'match.matchTypeKey',
          matchTypeKey,
          'match type',
        ),
      );
    }
    const { outcome } = segment;
    if (
      outcome?.kind === 'win' &&
      catalogs.methods !== undefined &&
      methodOf(read, outcome.methodKey) === undefined
    ) {
      issues.push(
        unknownKey(
          segment,
          SEGMENT_KEY_ISSUE_CODES.method,
          'outcome.methodKey',
          outcome.methodKey,
          'win method',
        ),
      );
    }
    // match.finishKey: checkSegmentFinishes. match.stipulationKeys: MTCH7 (stipulations).
    return issues;
  }
  const { angleTypeKey } = segment.angle;
  if (catalogs.angleTypes !== undefined && angleTypeOf(read, angleTypeKey) === undefined) {
    issues.push(
      unknownKey(
        segment,
        SEGMENT_KEY_ISSUE_CODES.angleType,
        'angle.angleTypeKey',
        angleTypeKey,
        'angle type',
      ),
    );
  }
  // angle.beats[].beatKey: MTCH5 (beats).
  return issues;
}

/**
 * Every unresolved catalog key on every stored segment, in segment ID order. Empty when the world
 * holds no catalogs.
 */
export function checkSegmentContentKeys(read: GameWorldView): IntegrityIssue[] {
  // values() lists rows in ID order.
  return read.tables.segments.values().flatMap((segment) => checkSegment(read, segment));
}
