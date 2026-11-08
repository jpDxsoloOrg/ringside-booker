/**
 * `reign-chronology`: a title's history reads as one line of champions.
 *
 * - Every reign is won before it is lost (`wonOn < lostOn`; a same-day reign is an error).
 * - No reign starts after the world's start date.
 * - A title has at most one open reign (no `lostOn`).
 * - A reign still running on the start date is the open one: a closed reign's `lostOn` is on or
 *   before the start date.
 * - Reigns of one title do not overlap. One reign may end on the day the next begins.
 */

import { compareDates } from '@ringside/engine';
import type { ValidationIssue } from '../issues';
import {
  recordIssue,
  refKey,
  sortedRecords,
  worldStartDate,
  type ContentRule,
  type MergedRecordOf,
} from './helpers';

type ReignEntry = [string, MergedRecordOf<'titleReign'>];

export const reignChronology: ContentRule = {
  id: 'reign-chronology',
  description:
    'Reigns of a title do not overlap, each is won before it is lost, and only the open reign runs past the start date',
  check(world, content) {
    const start = worldStartDate(world);
    const issues: ValidationIssue[] = [];
    const reignsByTitle = new Map<string, ReignEntry[]>();
    for (const entry of sortedRecords(content, 'titleReign')) {
      const [key, merged] = entry;
      const reign = merged.record;
      if (reign.lostOn !== null && compareDates(reign.wonOn, reign.lostOn) >= 0) {
        issues.push(
          recordIssue(
            'error',
            'reign-chronology',
            'titleReign',
            key,
            merged,
            ['lostOn'],
            `Reign ${key} is lost on ${reign.lostOn}, which is not after it was won on ${reign.wonOn}`,
          ),
        );
      }
      if (compareDates(reign.wonOn, start) > 0) {
        issues.push(
          recordIssue(
            'error',
            'reign-chronology',
            'titleReign',
            key,
            merged,
            ['wonOn'],
            `Reign ${key} is won on ${reign.wonOn}, after the world starts on ${start}`,
          ),
        );
      }
      if (reign.lostOn !== null && compareDates(reign.lostOn, start) > 0) {
        issues.push(
          recordIssue(
            'error',
            'reign-chronology',
            'titleReign',
            key,
            merged,
            ['lostOn'],
            `Reign ${key} ends on ${reign.lostOn}, after the world starts on ${start}; a reign still running on the start date must be left open (lostOn null)`,
          ),
        );
      }
      const titleKey = refKey(reign.titleKey);
      const list = reignsByTitle.get(titleKey) ?? [];
      list.push(entry);
      reignsByTitle.set(titleKey, list);
    }

    for (const titleKey of [...reignsByTitle.keys()].sort()) {
      const reigns = [...(reignsByTitle.get(titleKey) ?? [])].sort(
        ([leftKey, left], [rightKey, right]) =>
          compareDates(left.record.wonOn, right.record.wonOn) ||
          (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0),
      );
      const openReigns = reigns.filter(([, merged]) => merged.record.lostOn === null);
      for (const [key, merged] of openReigns.slice(1)) {
        issues.push(
          recordIssue(
            'error',
            'reign-chronology',
            'titleReign',
            key,
            merged,
            ['lostOn'],
            `Title ${titleKey} already has an open reign (${openReigns[0]?.[0] ?? ''}); only one reign can be current`,
          ),
        );
      }
      for (let index = 1; index < reigns.length; index += 1) {
        const previous = reigns[index - 1];
        const current = reigns[index];
        if (previous === undefined || current === undefined) {
          continue;
        }
        const [previousKey, previousMerged] = previous;
        const [key, merged] = current;
        const previousEnd = previousMerged.record.lostOn;
        if (previousEnd === null || compareDates(previousEnd, merged.record.wonOn) > 0) {
          issues.push(
            recordIssue(
              'error',
              'reign-chronology',
              'titleReign',
              key,
              merged,
              ['wonOn'],
              `Reign ${key} of title ${titleKey} starts on ${merged.record.wonOn}, while reign ${previousKey} is still running (${previousEnd === null ? 'open' : `until ${previousEnd}`})`,
            ),
          );
        }
      }
    }
    return issues;
  },
};
