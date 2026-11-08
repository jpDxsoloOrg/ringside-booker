/**
 * `unique-names`: people can be told apart by name.
 *
 * - No two people share a legal full name (error).
 * - No two people work under the same ring name in one promotion (error).
 * - No two people use the same ring name anywhere in the world (warning). Ring names are a
 *   person's default ring name plus the ring name on each of their contracts.
 *
 * Names are compared ignoring case, accents and punctuation, the same way the blocklist compares.
 */

import { nameForms } from '../blocklist';
import type { ValidationIssue } from '../issues';
import { legalName, recordIssue, refKey, sortedRecords, type ContentRule } from './helpers';

/** The form two names are compared in: lower case, no accents, punctuation read as a space. */
export function comparableName(name: string): string {
  return nameForms(name).spacedWords.join(' ');
}

export const uniqueNames: ContentRule = {
  id: 'unique-names',
  description:
    'Legal names are unique, ring names are unique within a promotion and should be unique across the world',
  check(_world, content) {
    const issues: ValidationIssue[] = [];
    const people = sortedRecords(content, 'person');

    const firstByLegalName = new Map<string, string>();
    for (const [key, merged] of people) {
      const name = comparableName(legalName(merged.record));
      const first = firstByLegalName.get(name);
      if (first === undefined) {
        firstByLegalName.set(name, key);
        continue;
      }
      issues.push(
        recordIssue(
          'error',
          'unique-names',
          'person',
          key,
          merged,
          ['givenName'],
          `${key} has the legal name "${legalName(merged.record)}", already used by ${first}`,
        ),
      );
    }

    // Ring names inside each promotion: contract ring names only.
    const firstInPromotion = new Map<string, { personKey: string; employmentKey: string }>();
    const clashedSlots = new Set<string>();
    for (const [key, merged] of sortedRecords(content, 'employment')) {
      const employment = merged.record;
      const promotionKey = refKey(employment.promotionKey);
      const personKey = refKey(employment.personKey);
      const slot = `${promotionKey}\u0000${comparableName(employment.ringName)}`;
      const first = firstInPromotion.get(slot);
      if (first === undefined) {
        firstInPromotion.set(slot, { personKey, employmentKey: key });
        continue;
      }
      if (first.personKey !== personKey) {
        clashedSlots.add(slot);
        issues.push(
          recordIssue(
            'error',
            'unique-names',
            'employment',
            key,
            merged,
            ['ringName'],
            `Ring name "${employment.ringName}" is already used in ${promotionKey} by ${first.personKey} (${first.employmentKey})`,
          ),
        );
      }
    }

    // Ring names across the world: default ring names and contract ring names.
    const holders = new Map<string, Set<string>>();
    const claim = (name: string, personKey: string): void => {
      const comparable = comparableName(name);
      const set = holders.get(comparable) ?? new Set<string>();
      set.add(personKey);
      holders.set(comparable, set);
    };
    for (const [key, merged] of people) {
      claim(merged.record.defaultRingName, key);
    }
    for (const [, merged] of sortedRecords(content, 'employment')) {
      claim(merged.record.ringName, refKey(merged.record.personKey));
    }
    const othersUsing = (name: string, personKey: string): string[] =>
      [...(holders.get(comparableName(name)) ?? [])].filter((owner) => owner !== personKey).sort();
    for (const [key, merged] of people) {
      const others = othersUsing(merged.record.defaultRingName, key);
      if (others.length > 0) {
        issues.push(
          recordIssue(
            'warning',
            'unique-names',
            'person',
            key,
            merged,
            ['defaultRingName'],
            `Ring name "${merged.record.defaultRingName}" is also used by ${others.join(', ')}`,
          ),
        );
      }
    }
    // A contract ring name that differs from the person's default ring name is checked on the
    // contract, so a name two people only use under contract (in different promotions) is caught.
    // A clash inside one promotion is already an error above and is not repeated as a warning.
    const defaultRingNames = new Map(
      people.map(([key, merged]) => [key, comparableName(merged.record.defaultRingName)]),
    );
    for (const [key, merged] of sortedRecords(content, 'employment')) {
      const employment = merged.record;
      const personKey = refKey(employment.personKey);
      const comparable = comparableName(employment.ringName);
      if (defaultRingNames.get(personKey) === comparable) {
        continue;
      }
      const slot = `${refKey(employment.promotionKey)}\u0000${comparable}`;
      if (clashedSlots.has(slot)) {
        continue;
      }
      const others = othersUsing(employment.ringName, personKey);
      if (others.length > 0) {
        issues.push(
          recordIssue(
            'warning',
            'unique-names',
            'employment',
            key,
            merged,
            ['ringName'],
            `Ring name "${employment.ringName}" is also used by ${others.join(', ')}`,
          ),
        );
      }
    }
    return issues;
  },
};
