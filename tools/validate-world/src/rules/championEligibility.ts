/**
 * `champion-eligibility`: every current champion could really hold the belt. For each open reign
 * (no `lostOn`):
 *
 * - each holder has a contract with the title's promotion running on the world's start date;
 * - each holder fits the title's division: gender (`open` takes anyone, `male` and `female` take
 *   only people of that gender) and the weight limits, when the title has them;
 * - the reign has exactly `holderCount` holders;
 * - a tag or trios reign names a team (`teamKey`) of that size whose members are exactly the
 *   holders.
 */

import type { GameDate, MergedContent, TitleDivision } from '@ringside/engine';
import type { ValidationIssue } from '../issues';
import {
  isEmploymentActiveOn,
  recordIssue,
  refKey,
  sortedRecords,
  worldStartDate,
  type ContentRule,
  type MergedRecordOf,
  type PersonRecord,
} from './helpers';

/** Why a person does not fit a division, or null when they do. */
export function divisionMismatch(person: PersonRecord, division: TitleDivision): string | null {
  if (division.gender !== 'open' && person.gender !== division.gender) {
    return `is ${person.gender}, but the division is ${division.gender} only`;
  }
  if (division.minWeightKg !== null && person.weightKg < division.minWeightKg) {
    return `weighs ${String(person.weightKg)} kg, under the division minimum of ${String(division.minWeightKg)} kg`;
  }
  if (division.maxWeightKg !== null && person.weightKg > division.maxWeightKg) {
    return `weighs ${String(person.weightKg)} kg, over the division limit of ${String(division.maxWeightKg)} kg`;
  }
  return null;
}

function employedBy(
  content: MergedContent,
  personKey: string,
  promotionKey: string,
  date: GameDate,
): boolean {
  for (const merged of content.records.employment.values()) {
    const employment = merged.record;
    if (
      refKey(employment.personKey) === personKey &&
      refKey(employment.promotionKey) === promotionKey &&
      isEmploymentActiveOn(employment, date)
    ) {
      return true;
    }
  }
  return false;
}

function checkTeam(
  content: MergedContent,
  key: string,
  merged: MergedRecordOf<'titleReign'>,
  holderKeys: readonly string[],
  holderCount: number,
): ValidationIssue[] {
  const reign = merged.record;
  const teamRef = reign.teamKey ?? null;
  if (teamRef === null) {
    return [
      recordIssue(
        'error',
        'champion-eligibility',
        'titleReign',
        key,
        merged,
        ['teamKey'],
        `A reign with ${String(holderCount)} holders must name the team that holds it`,
      ),
    ];
  }
  const teamKey = refKey(teamRef);
  const team = content.records.team.get(teamKey)?.record;
  if (team === undefined) {
    return [];
  }
  const issues: ValidationIssue[] = [];
  if (team.memberKeys.length !== holderCount) {
    issues.push(
      recordIssue(
        'error',
        'champion-eligibility',
        'titleReign',
        key,
        merged,
        ['teamKey'],
        `Team ${teamKey} has ${String(team.memberKeys.length)} members, but the title is held by ${String(holderCount)}`,
      ),
    );
  }
  const memberKeys = new Set(team.memberKeys.map(refKey));
  const sameMembers =
    memberKeys.size === holderKeys.length && holderKeys.every((holder) => memberKeys.has(holder));
  if (!sameMembers) {
    issues.push(
      recordIssue(
        'error',
        'champion-eligibility',
        'titleReign',
        key,
        merged,
        ['teamKey'],
        `Team ${teamKey} is ${[...memberKeys].sort().join(', ')}, but the holders are ${[...holderKeys].sort().join(', ')}`,
      ),
    );
  }
  return issues;
}

export const championEligibility: ContentRule = {
  id: 'champion-eligibility',
  description:
    "Current champions are under contract with the title's promotion, fit its division and match its holder count and team",
  check(world, content) {
    const start = worldStartDate(world);
    const issues: ValidationIssue[] = [];
    for (const [key, merged] of sortedRecords(content, 'titleReign')) {
      const reign = merged.record;
      if (reign.lostOn !== null) {
        continue;
      }
      const titleKey = refKey(reign.titleKey);
      const title = content.records.title.get(titleKey)?.record;
      if (title === undefined) {
        continue;
      }
      const promotionKey = refKey(title.promotionKey);
      const holderKeys = reign.holderPersonKeys.map(refKey);
      if (holderKeys.length !== title.holderCount) {
        issues.push(
          recordIssue(
            'error',
            'champion-eligibility',
            'titleReign',
            key,
            merged,
            ['holderPersonKeys'],
            `Title ${titleKey} is held by ${String(title.holderCount)} at a time, but this reign names ${String(holderKeys.length)}`,
          ),
        );
      }
      holderKeys.forEach((holderKey, index) => {
        if (!employedBy(content, holderKey, promotionKey, start)) {
          issues.push(
            recordIssue(
              'error',
              'champion-eligibility',
              'titleReign',
              key,
              merged,
              ['holderPersonKeys', index],
              `Champion ${holderKey} has no contract with ${promotionKey}, the promotion of title ${titleKey}, on ${start}`,
            ),
          );
        }
        const person = content.records.person.get(holderKey)?.record;
        const mismatch = person === undefined ? null : divisionMismatch(person, title.division);
        if (mismatch !== null) {
          issues.push(
            recordIssue(
              'error',
              'champion-eligibility',
              'titleReign',
              key,
              merged,
              ['holderPersonKeys', index],
              `Champion ${holderKey} ${mismatch} for title ${titleKey}`,
            ),
          );
        }
      });
      if (title.holderCount > 1) {
        issues.push(...checkTeam(content, key, merged, holderKeys, title.holderCount));
      }
    }
    return issues;
  },
};
