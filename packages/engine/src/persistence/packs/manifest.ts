/**
 * The pack manifest: `pack.json` at the root of every pack folder.
 *
 * It names the pack, says what kind of pack it is, which packs it builds on, and which file holds
 * each kind of record. Unknown fields are errors, so a typo such as `dependOn` fails loudly instead
 * of silently dropping a dependency.
 *
 * Format doc: docs/design/data-packs.md.
 */

import { z } from 'zod';
import { hasDuplicates } from '../../model/entities/unique';
import { isoDateSchema } from './fields';
import { packIdSchema, RecordKindSchema } from './keys';

/** The newest pack format this build reads. */
export const PACK_FORMAT_VERSION = 1;

/**
 * What a pack is for:
 * - `base`: shared data with no world of its own (names, generation numbers).
 * - `world`: a playable starting world; it sets the start date.
 * - `addon`: adds to or changes the packs it depends on.
 */
export const PACK_KINDS = ['base', 'world', 'addon'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/** A semantic version: `MAJOR.MINOR.PATCH`, with optional pre-release and build parts. */
export const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const PARTIAL_VERSION = String.raw`(?:0|[1-9]\d*|[xX*])(?:\.(?:0|[1-9]\d*|[xX*])){0,2}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const COMPARATOR = String.raw`(?:\^|~|>=|<=|>|<|=)?${PARTIAL_VERSION}`;
const COMPARATOR_SET = String.raw`${COMPARATOR}(?: +${COMPARATOR})*`;

/**
 * A version range in the npm style: comparators (`^1.2.0`, `~1.2`, `>=1.0.0 <2.0.0`, `1.x`, `*`),
 * space-separated within a set, with sets joined by `||`.
 */
export const SEMVER_RANGE_PATTERN = new RegExp(
  String.raw`^\s*${COMPARATOR_SET}(?:\s*\|\|\s*${COMPARATOR_SET})*\s*$`,
);

/**
 * A file inside the pack folder: slash-separated lowercase segments ending in `.json`, such as
 * `geography/regions.json`. No `..`, no absolute paths, no backslashes.
 */
export const PACK_FILE_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.json$/;

const packDependencySchema = z.strictObject({
  id: packIdSchema,
  /** The versions of the dependency this pack works with, such as `^1.0.0`. */
  version: z
    .string()
    .regex(SEMVER_RANGE_PATTERN, 'Expected a version range such as "^1.0.0" or ">=1.2.0 <2.0.0"'),
});

const packFileSchema = z
  .string()
  .regex(PACK_FILE_PATTERN, 'Expected a relative .json path such as "geography/regions.json"');

/** The manifest's fields once the format version has been accepted. */
const manifestFieldsSchema = z
  .strictObject({
    formatVersion: z.literal(PACK_FORMAT_VERSION),
    id: packIdSchema,
    name: z.string().min(1).max(80),
    /** This pack's own version. */
    version: z.string().regex(SEMVER_PATTERN, 'Expected a version such as "1.0.0"'),
    kind: z.enum(PACK_KINDS),
    description: z.string().max(2000),
    author: z.string().min(1).max(80),
    dependsOn: z.array(packDependencySchema),
    /** The day a new game in this world starts. Required for `world` packs, and only for them. */
    startDate: isoDateSchema.optional(),
    /** Which file holds each kind of record. Kinds left out have no records in this pack. */
    files: z.partialRecord(RecordKindSchema, packFileSchema),
  })
  .superRefine((manifest, context) => {
    if (manifest.kind === 'world' && manifest.startDate === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A world pack must set startDate',
        path: ['startDate'],
      });
    }
    if (manifest.kind !== 'world' && manifest.startDate !== undefined) {
      context.addIssue({
        code: 'custom',
        message: `Only world packs set startDate, not ${manifest.kind} packs`,
        path: ['startDate'],
      });
    }
    const dependencyIds = manifest.dependsOn.map((dependency) => dependency.id);
    if (hasDuplicates(dependencyIds)) {
      context.addIssue({
        code: 'custom',
        message: 'Each dependency may be listed only once',
        path: ['dependsOn'],
      });
    }
    manifest.dependsOn.forEach((dependency, index) => {
      if (dependency.id === manifest.id) {
        context.addIssue({
          code: 'custom',
          message: 'A pack cannot depend on itself',
          path: ['dependsOn', index, 'id'],
        });
      }
    });
    const filePaths = Object.values(manifest.files);
    if (hasDuplicates(filePaths)) {
      context.addIssue({
        code: 'custom',
        message: 'Each record kind needs its own file',
        path: ['files'],
      });
    }
  });

function describePackId(id: unknown): string {
  return typeof id === 'string' && id.length > 0 ? id : '(no id)';
}

/**
 * Reads the format version before anything else. A pack written for a newer build may have a
 * different shape entirely, so its other fields are not checked against this format at all.
 */
const formatGateSchema = z
  .looseObject({ formatVersion: z.number().int().min(1) })
  .superRefine((manifest, context) => {
    if (manifest.formatVersion > PACK_FORMAT_VERSION) {
      context.addIssue({
        code: 'custom',
        message: `pack ${describePackId(manifest['id'])} uses format ${String(manifest.formatVersion)}, this build reads up to ${String(PACK_FORMAT_VERSION)}`,
        path: ['formatVersion'],
      });
    }
  });

export const packManifestSchema = formatGateSchema.pipe(manifestFieldsSchema);

export type PackManifest = z.output<typeof packManifestSchema>;
export type PackDependency = z.output<typeof packDependencySchema>;
