/**
 * `blocklist`: no real performer, promotion, show, title or network name appears in the content.
 *
 * Checks every person's legal name and default ring name, every contract's ring name, every
 * promotion's full and short name, and the names of brands, titles, venues, networks, event
 * definitions, teams and the match and segment catalogs (match types, angle types, methods) against
 * the blocklist (see `../blocklist.ts` for how names are compared).
 * Each hit is an error naming the pack, file, record key, field and the entry it matched.
 */

import type { MergedContent, packs, RecordKind } from '@ringside/engine';
import { findBlockedName, type Blocklist } from '../blocklist';
import type { ValidationIssue } from '../issues';
import { legalName, recordIssue, sortedRecords, type ContentRule } from './helpers';

/** One name to check: the field it lives in (as a path), what to call it and its text. */
interface NamedField {
  readonly field: readonly string[];
  readonly label: string;
  readonly value: string;
}

function checkKind<Kind extends RecordKind>(
  content: MergedContent,
  blocklist: Blocklist,
  kind: Kind,
  fieldsOf: (record: packs.PackRecords[Kind]) => NamedField[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [key, merged] of sortedRecords(content, kind)) {
    for (const { field, label, value } of fieldsOf(merged.record)) {
      const entry = findBlockedName(value, blocklist);
      if (entry === null) {
        continue;
      }
      issues.push(
        recordIssue(
          'error',
          'blocklist',
          kind,
          key,
          merged,
          field,
          `${label} "${value}" matches the real name "${entry.name}" (${entry.source}:${String(entry.line)}); rename it`,
        ),
      );
    }
  }
  return issues;
}

/** The blocklist rule for a loaded blocklist. */
export function createBlocklistRule(blocklist: Blocklist): ContentRule {
  return {
    id: 'blocklist',
    description:
      'No person, ring, promotion, title, venue, network or event name is on the real-name blocklist',
    check(_world, content) {
      return [
        ...checkKind(content, blocklist, 'person', (person) => [
          { field: ['givenName'], label: 'Legal name', value: legalName(person) },
          { field: ['defaultRingName'], label: 'Ring name', value: person.defaultRingName },
        ]),
        ...checkKind(content, blocklist, 'employment', (employment) => [
          { field: ['ringName'], label: 'Ring name', value: employment.ringName },
        ]),
        ...checkKind(content, blocklist, 'promotion', (promotion) => [
          { field: ['name'], label: 'Promotion name', value: promotion.name },
          { field: ['shortName'], label: 'Promotion short name', value: promotion.shortName },
        ]),
        ...checkKind(content, blocklist, 'brand', (brand) => [
          { field: ['name'], label: 'Brand name', value: brand.name },
        ]),
        ...checkKind(content, blocklist, 'title', (title) => [
          { field: ['name'], label: 'Title name', value: title.name },
        ]),
        ...checkKind(content, blocklist, 'venue', (venue) => [
          { field: ['name'], label: 'Venue name', value: venue.name },
        ]),
        ...checkKind(content, blocklist, 'network', (network) => [
          { field: ['name'], label: 'Network name', value: network.name },
        ]),
        ...checkKind(content, blocklist, 'eventDefinition', (definition) => [
          { field: ['name'], label: 'Event name', value: definition.name },
        ]),
        ...checkKind(content, blocklist, 'team', (team) => [
          { field: ['name'], label: 'Team name', value: team.name },
        ]),
        ...checkKind(content, blocklist, 'matchType', (matchType) => [
          { field: ['name'], label: 'Match type name', value: matchType.name },
          ...(matchType.shortName === undefined
            ? []
            : [
                {
                  field: ['shortName'],
                  label: 'Match type short name',
                  value: matchType.shortName,
                },
              ]),
        ]),
        ...checkKind(content, blocklist, 'angleType', (angleType) => [
          { field: ['name'], label: 'Angle type name', value: angleType.name },
          ...(angleType.shortName === undefined
            ? []
            : [
                {
                  field: ['shortName'],
                  label: 'Angle type short name',
                  value: angleType.shortName,
                },
              ]),
        ]),
        ...checkKind(content, blocklist, 'method', (method) => [
          { field: ['name'], label: 'Method name', value: method.name },
        ]),
      ];
    },
  };
}
