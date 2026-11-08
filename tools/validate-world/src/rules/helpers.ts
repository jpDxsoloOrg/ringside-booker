/**
 * Shared pieces for the content rules: the rule shape, record lookups by key, and issues that point
 * at a merged record's pack, file and field.
 */

import {
  compareDates,
  packs,
  type GameDate,
  type GameWorldView,
  type MergedContent,
  type PackIssueSeverity,
  type RecordKind,
} from '@ringside/engine';
import { issueWithSeverity, type RuleId, type ValidationIssue } from '../issues';

/**
 * A content rule: a check that the schemas and the loader cannot express, because it is policy for
 * shipped content rather than a property of a valid pack. A modder's world may break any of them.
 */
export interface ContentRule {
  readonly id: RuleId;
  /** One line for `--help` and the README. */
  readonly description: string;
  readonly check: (world: GameWorldView, content: MergedContent) => ValidationIssue[];
}

export type MergedRecordOf<Kind extends RecordKind> = packs.MergedRecord<packs.PackRecords[Kind]>;

export type PersonRecord = packs.PersonRecord;
export type EmploymentRecord = packs.EmploymentRecord;

/** The record key a reference points at (`mini-base:north-ridge` → `north-ridge`). */
export function refKey(ref: packs.PackRef): string {
  return packs.parseRef(ref).key;
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** A kind's merged records as `[key, merged]` pairs, sorted by key. */
export function sortedRecords<Kind extends RecordKind>(
  content: MergedContent,
  kind: Kind,
): [string, MergedRecordOf<Kind>][] {
  const records: ReadonlyMap<string, MergedRecordOf<Kind>> = content.records[kind];
  return [...records.entries()].sort(([left], [right]) => compareText(left, right));
}

/** An issue on one field of a merged record, located in the pack and file that last wrote it. */
export function recordIssue<Kind extends RecordKind>(
  severity: PackIssueSeverity,
  code: RuleId,
  kind: Kind,
  key: string,
  merged: MergedRecordOf<Kind>,
  field: readonly (string | number)[],
  message: string,
): ValidationIssue {
  return issueWithSeverity(severity, {
    code,
    packId: merged.sourcePackId,
    file: merged.file,
    kind,
    recordKey: key,
    path: [kind, key, ...field],
    message,
  });
}

/** The first day of the loaded world. */
export function worldStartDate(world: GameWorldView): GameDate {
  return world.meta.startDate;
}

/** True when a contract runs on `date`: started on or before it and not yet ended. */
export function isEmploymentActiveOn(employment: EmploymentRecord, date: GameDate): boolean {
  return (
    compareDates(employment.startsOn, date) <= 0 &&
    (employment.endsOn === null || compareDates(employment.endsOn, date) > 0)
  );
}

/** Every contract running on `date`, as `[key, merged]` pairs sorted by key. */
export function activeEmployments(
  content: MergedContent,
  date: GameDate,
): [string, MergedRecordOf<'employment'>][] {
  return sortedRecords(content, 'employment').filter(([, merged]) =>
    isEmploymentActiveOn(merged.record, date),
  );
}

/** A person's legal name: given name, then family name when there is one. */
export function legalName(person: PersonRecord): string {
  return person.familyName.length === 0
    ? person.givenName
    : `${person.givenName} ${person.familyName}`;
}

/** True for a person who is still around to be booked or hired (status left out = active). */
export function isActivePerson(person: PersonRecord): boolean {
  return person.status === undefined || person.status === 'active';
}

export function isWrestler(person: PersonRecord): boolean {
  return person.roles.includes('wrestler');
}
