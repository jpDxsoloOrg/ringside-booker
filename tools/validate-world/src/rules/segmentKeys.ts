/**
 * `segment-keys`: the match and segment catalogs are usable, and every stored segment key resolves.
 *
 * - Builds the catalogs from the merged records exactly as a new game snapshots them
 *   (`packs.catalogsFromRecords`) and runs the engine's `checkSegmentContentKeys` on the loaded
 *   world with them: an unknown match type, win method or angle type on a segment is an error
 *   naming the segment and the field.
 * - Booking needs a singles-like match type: at least one match type that is not hidden, with
 *   `sides.min` 2 and `sideSize.min` 1 (error).
 * - No two entries of one catalog share a name, compared the way `unique-names` compares (error).
 * - Every angle type's `defaultBeatKey` is a content key in the `beat.` namespace (error). The
 *   record schema already refuses anything else; this keeps the rule honest if it ever loosens.
 *
 * A world whose packs define no match types at all has no match type catalog, so the singles check
 * is skipped, the same way the engine skips a catalog the world does not hold.
 */

import {
  checkSegmentContentKeys,
  isContentKey,
  packs,
  type GameWorldView,
  type IntegrityIssue,
  type MergedContent,
} from '@ringside/engine';
import { validationError, type ValidationIssue } from '../issues';
import { recordIssue, sortedRecords, type ContentRule } from './helpers';
import { comparableName } from './uniqueNames';

type CatalogKind = 'matchType' | 'angleType' | 'method';

const CATALOG_KINDS: readonly CatalogKind[] = ['matchType', 'angleType', 'method'];

const KIND_LABELS: Readonly<Record<CatalogKind, string>> = {
  matchType: 'match type',
  angleType: 'angle type',
  method: 'method',
};

/** A segment issue from the engine, located in the last pack loaded (segments have no record). */
function segmentIssue(issue: IntegrityIssue, packId: string): ValidationIssue {
  return validationError({
    code: 'segment-keys',
    packId,
    path: [
      issue.table,
      ...(issue.id === undefined ? [] : [issue.id]),
      ...(issue.path === undefined ? [] : issue.path.split('.')),
    ],
    message: issue.message,
  });
}

function checkSegments(world: GameWorldView, content: MergedContent): ValidationIssue[] {
  const catalogs = packs.catalogsFromRecords(content.records);
  const view: GameWorldView = { ...world, meta: { ...world.meta, catalogs } };
  const packId = content.packs.at(-1)?.id ?? '';
  return checkSegmentContentKeys(view).map((issue) => segmentIssue(issue, packId));
}

function checkSinglesLike(content: MergedContent): ValidationIssue[] {
  const matchTypes = sortedRecords(content, 'matchType');
  if (matchTypes.length === 0) {
    return [];
  }
  const singlesLike = matchTypes.some(
    ([, merged]) =>
      merged.record.hidden !== true &&
      merged.record.sides.min === 2 &&
      merged.record.sideSize.min === 1,
  );
  if (singlesLike) {
    return [];
  }
  const [firstKey, first] = matchTypes[0] ?? [];
  if (firstKey === undefined || first === undefined) {
    return [];
  }
  return [
    recordIssue(
      'error',
      'segment-keys',
      'matchType',
      firstKey,
      first,
      [],
      'No visible match type has sides.min 2 and sideSize.min 1; booking needs at least one singles-like match type',
    ),
  ];
}

function checkUniqueNames(content: MergedContent, kind: CatalogKind): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstByName = new Map<string, string>();
  for (const [key, merged] of sortedRecords(content, kind)) {
    const { name } = merged.record;
    const comparable = comparableName(name);
    const first = firstByName.get(comparable);
    if (first === undefined) {
      firstByName.set(comparable, key);
      continue;
    }
    issues.push(
      recordIssue(
        'error',
        'segment-keys',
        kind,
        key,
        merged,
        ['name'],
        `${KIND_LABELS[kind]} ${key} is named "${name}", already used by ${first}`,
      ),
    );
  }
  return issues;
}

function checkDefaultBeats(content: MergedContent): ValidationIssue[] {
  const prefix = `${packs.BEAT_CONTENT_PREFIX}.`;
  return sortedRecords(content, 'angleType')
    .filter(([, merged]) => {
      const beatKey: string = merged.record.defaultBeatKey;
      return !isContentKey(beatKey) || !beatKey.startsWith(prefix);
    })
    .map(([key, merged]) =>
      recordIssue(
        'error',
        'segment-keys',
        'angleType',
        key,
        merged,
        ['defaultBeatKey'],
        `defaultBeatKey ${merged.record.defaultBeatKey} is not a beat content key (expected "${prefix}<name>")`,
      ),
    );
}

export const segmentKeys: ContentRule = {
  id: 'segment-keys',
  description:
    'Every stored segment key names a catalog entry; the catalogs have a singles-like match type, unique names and beat default keys',
  check(world, content) {
    return [
      ...checkSegments(world, content),
      ...checkSinglesLike(content),
      ...CATALOG_KINDS.flatMap((kind) => checkUniqueNames(content, kind)),
      ...checkDefaultBeats(content),
    ];
  },
};
