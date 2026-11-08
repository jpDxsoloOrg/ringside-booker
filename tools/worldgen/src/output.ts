/**
 * Turning the build into pack files: people as `person` records with region keys instead of IDs,
 * every file checked against the engine's pack schemas, sorted by key, two-space indented and
 * ending in a newline, so the same build always gives the same bytes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseId, recordFileSchema } from '@ringside/engine';
import type { BuildContext } from './context';
import { GENERATED_FILES, type GeneratedKind } from './content';
import type { EmploymentOut, PersonOut, ReignOut, RosterMember, TeamOut } from './model';
import { compareText } from './stats';

/** A member's person as a pack record. */
export function personRecordOf(context: BuildContext, member: RosterMember): PersonOut {
  const { person } = member;
  const regionalPop: Record<string, number> = {};
  const byKey = Object.entries(person.regionalPop)
    .map(([regionId, value]): [string, number] => [
      context.regionKey(parseId('region', regionId)),
      value,
    ])
    .sort(([left], [right]) => compareText(left, right));
  for (const [key, value] of byKey) {
    regionalPop[key] = value;
  }
  const ceilings: Record<string, number> = {};
  for (const [key, value] of Object.entries(person.development.ceilings).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    ceilings[key] = value;
  }
  return {
    key: member.key,
    givenName: person.givenName,
    familyName: person.familyName,
    defaultRingName: person.defaultRingName,
    gender: person.gender,
    birthDate: person.birthDate,
    debutDate: person.debutDate,
    birthRegionKey: context.regionKey(person.birthRegionId),
    basedInRegionKey: context.regionKey(person.basedInRegionId),
    masked: person.masked,
    tags: [...person.tags],
    roles: [...person.roles],
    career: { ...person.career },
    motivation: person.motivation,
    heightCm: person.heightCm,
    weightKg: person.weightKg,
    build: person.build,
    style: person.style,
    attributes: { ...person.attributes },
    condition: { ...person.condition },
    development: { potential: person.development.potential, ceilings },
    regionalPop,
    traits: [...person.traits],
    vices: { ...person.vices },
  };
}

/** The four generated files' contents, by record kind. */
export interface RosterFiles {
  readonly person: readonly PersonOut[];
  readonly employment: readonly EmploymentOut[];
  readonly team: readonly TeamOut[];
  readonly titleReign: readonly ReignOut[];
}

/** A file's text: records sorted by key, two-space indent, trailing newline. */
export function serialiseRecords(rows: readonly { readonly key: string }[]): string {
  const sorted = [...rows].sort((left, right) => compareText(left.key, right.key));
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** Checks a file against the engine's pack schema for its kind; throws naming every problem. */
function checkFile(kind: GeneratedKind, rows: readonly unknown[]): void {
  const parsed = recordFileSchema(kind).safeParse(rows);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Generated ${GENERATED_FILES[kind]} is not a valid pack file:\n  ${problems}`);
  }
}

/** Every generated file as text, keyed by file name, after a schema check. */
export function renderRosterFiles(files: RosterFiles): Map<string, string> {
  checkFile('person', files.person);
  checkFile('employment', files.employment);
  checkFile('team', files.team);
  checkFile('titleReign', files.titleReign);
  return new Map([
    [GENERATED_FILES.person, serialiseRecords(files.person)],
    [GENERATED_FILES.employment, serialiseRecords(files.employment)],
    [GENERATED_FILES.team, serialiseRecords(files.team)],
    [GENERATED_FILES.titleReign, serialiseRecords(files.titleReign)],
  ]);
}

/** Writes the rendered files into `directory`. */
export async function writeRosterFiles(
  directory: string,
  rendered: ReadonlyMap<string, string>,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const [file, text] of rendered) {
    await writeFile(join(directory, file), text, 'utf8');
  }
}
