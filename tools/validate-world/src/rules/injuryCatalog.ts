/**
 * `injury-catalog` (WRK6-01): the injury catalog is usable and every stored injury names one of it.
 *
 * The catalog is the one the merged packs build (`packs.injuryCatalogFromRecords`), or the world's
 * own snapshot (`meta.catalogs.injuries`) when no pack defines injury kinds:
 *
 * - every body part has at least one injury kind (warning, so a modder may narrow the catalog);
 * - no two injury kinds share a label, ignoring case (error on the later key);
 * - every person's `injury.kindKey` names an injury kind (error; the path names the person's pack
 *   key, or the person ID for someone the packs did not define).
 *
 * A world with no injury catalog at all is not checked.
 */

import {
  BODY_PARTS,
  packs,
  type GameWorldView,
  type InjuryKind,
  type MergedContent,
} from '@ringside/engine';
import { validationError, validationWarning, type ValidationIssue } from '../issues';
import { recordIssue, sortedRecords, type ContentRule } from './helpers';

const CODE = 'injury-catalog';

function catalogOf(
  world: GameWorldView,
  content: MergedContent,
): Readonly<Record<string, InjuryKind>> | undefined {
  return packs.injuryCatalogFromRecords(content.records) ?? world.meta.catalogs.injuries;
}

/** Where a catalog-wide issue lands: the pack that last wrote an injury kind, else the last pack. */
function catalogPackId(content: MergedContent): string {
  const records = sortedRecords(content, 'injuryKind');
  return records.at(-1)?.[1].sourcePackId ?? content.packs.at(-1)?.id ?? '';
}

function missingBodyParts(
  catalog: Readonly<Record<string, InjuryKind>>,
  content: MergedContent,
): ValidationIssue[] {
  const covered = new Set(Object.values(catalog).map((kind) => kind.bodyPart));
  return BODY_PARTS.filter((part) => !covered.has(part)).map((part) =>
    validationWarning({
      code: CODE,
      packId: catalogPackId(content),
      kind: 'injuryKind',
      path: ['injuryKind'],
      message: `No injury kind hurts the ${part}; add at least one so every body part can be injured`,
    }),
  );
}

function duplicateLabels(
  catalog: Readonly<Record<string, InjuryKind>>,
  content: MergedContent,
): ValidationIssue[] {
  const firstKeyByLabel = new Map<string, string>();
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(catalog).sort()) {
    const kind = catalog[key];
    if (kind === undefined) {
      continue;
    }
    const label = kind.label.trim().toLowerCase();
    const first = firstKeyByLabel.get(label);
    if (first === undefined) {
      firstKeyByLabel.set(label, key);
      continue;
    }
    const packKey = key.slice(packs.INJURY_CONTENT_PREFIX.length + 1);
    const merged = content.records.injuryKind.get(packKey);
    const message = `Label "${kind.label}" is already used by ${first}; give each injury kind its own label`;
    issues.push(
      merged === undefined
        ? validationError({
            code: CODE,
            packId: content.packs.at(-1)?.id ?? '',
            path: ['meta', 'catalogs', 'injuries', key, 'label'],
            message,
          })
        : recordIssue('error', CODE, 'injuryKind', packKey, merged, ['label'], message),
    );
  }
  return issues;
}

function unknownInjuryKeys(
  world: GameWorldView,
  catalog: Readonly<Record<string, InjuryKind>>,
  content: MergedContent,
): ValidationIssue[] {
  const packKeyById = new Map<string, string>();
  for (const [packKey, id] of Object.entries(world.meta.contentKeys['person'] ?? {})) {
    packKeyById.set(id, packKey);
  }
  const issues: ValidationIssue[] = [];
  for (const person of world.tables.people.values()) {
    const injury = person.injury;
    if (injury === null || Object.hasOwn(catalog, injury.kindKey)) {
      continue;
    }
    const packKey = packKeyById.get(person.id);
    const merged = packKey === undefined ? undefined : content.records.person.get(packKey);
    const message = `Injury "${injury.kindKey}" is not in the injury catalog`;
    issues.push(
      packKey === undefined || merged === undefined
        ? validationError({
            code: CODE,
            packId: content.packs.at(-1)?.id ?? '',
            path: ['people', person.id, 'injury', 'kindKey'],
            message,
          })
        : recordIssue('error', CODE, 'person', packKey, merged, ['injury', 'kindKey'], message),
    );
  }
  return issues;
}

export const injuryCatalog: ContentRule = {
  id: CODE,
  description:
    'The injury catalog covers every body part with distinct labels, and every stored injury names one of its kinds',
  check(world: GameWorldView, content: MergedContent) {
    const catalog = catalogOf(world, content);
    if (catalog === undefined) {
      return [];
    }
    return [
      ...missingBodyParts(catalog, content),
      ...duplicateLabels(catalog, content),
      ...unknownInjuryKeys(world, catalog, content),
    ];
  },
};
