/**
 * Title reigns: the lineage of a title as data.
 *
 * One row per reign. `lostOn === null` marks the current reign, and the unique `openByTitle` index
 * allows only one of those per title, so "who holds it" is a single lookup. Holders are people
 * (`PersonId`), not employments: a reign still belongs to the champion after they leave.
 *
 * `holderNamesAtTime` keeps the ring names the holders used when they won, so the title history
 * reads correctly after a rename.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { compareDates, type GameDate } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zNonNegativeInt } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { hasDuplicates, isPresentIff, zName } from './entity-refinements';
import { titlesTable } from './title';

export const REIGN_END_REASONS = ['lost', 'vacated', 'stripped', 'retired', 'unified'] as const;
export type ReignEndReason = (typeof REIGN_END_REASONS)[number];

/** The most holders a reign can have (a trios title). */
export const MAX_REIGN_HOLDERS = 3;

export const TitleReignSchema = z
  .strictObject({
    id: zId('titleReign'),
    titleId: zId('title'),
    holderIds: z
      .array(zId('person'))
      .min(1)
      .max(MAX_REIGN_HOLDERS)
      .refine((holderIds) => !hasDuplicates(holderIds), { message: 'holderIds must be unique' }),
    /** The team that holds a tag or trios title, when the holders won it as a team. */
    teamId: zId('team').nullable(),
    wonOn: zGameDate,
    /** Null while this is the current reign. */
    lostOn: zGameDate.nullable(),
    /** The segment the title was won in; null for an inaugural or awarded reign. */
    wonInSegmentId: zId('segment').nullable(),
    /** The segment the reign ended in; null while current or when it ended outside a match. */
    endedInSegmentId: zId('segment').nullable(),
    /** Why the reign ended. Set exactly when `lostOn` is set. */
    endReason: z.enum(REIGN_END_REASONS).nullable(),
    /** Successful defences during the reign. */
    defences: zNonNegativeInt,
    /** Ring names at the time of the win, in the same order as `holderIds`. */
    holderNamesAtTime: z.array(zName(80)),
  })
  .refine((reign) => reign.lostOn === null || compareDates(reign.lostOn, reign.wonOn) >= 0, {
    message: 'lostOn must not be before wonOn',
    path: ['lostOn'],
  })
  .refine((reign) => isPresentIff(reign.endReason, reign.lostOn !== null), {
    message: 'endReason is set exactly when lostOn is set',
    path: ['endReason'],
  })
  .refine((reign) => reign.endedInSegmentId === null || reign.lostOn !== null, {
    message: 'a current reign cannot have endedInSegmentId',
    path: ['endedInSegmentId'],
  })
  .refine((reign) => reign.holderNamesAtTime.length === reign.holderIds.length, {
    message: 'holderNamesAtTime must have one name per holder',
    path: ['holderNamesAtTime'],
  });

export type TitleReign = z.infer<typeof TitleReignSchema>;

/** Rule (1): a reign has exactly as many holders as its title takes. */
function checkHolderCounts(view: WorldView): IntegrityIssue[] {
  const titles = tableOf(view, titlesTable);
  const issues: IntegrityIssue[] = [];
  for (const reign of tableOf(view, titleReignsTable).values()) {
    const title = titles.get(reign.titleId);
    if (title === undefined || reign.holderIds.length === title.holderCount) {
      continue;
    }
    issues.push({
      code: 'titleReigns.holderCountMismatch',
      table: 'titleReigns',
      id: reign.id,
      path: 'holderIds',
      message: `titleReigns ${reign.id}: ${String(reign.holderIds.length)} holders on ${title.id}, which takes ${String(title.holderCount)}`,
    });
  }
  return issues;
}

interface ReignSpan {
  readonly id: string;
  readonly wonOn: GameDate;
  readonly lostOn: GameDate | null;
}

/** Earlier start first; on the same start day, the reign that ended (soonest) comes first. */
function compareSpans(left: ReignSpan, right: ReignSpan): number {
  const byStart = compareDates(left.wonOn, right.wonOn);
  if (byStart !== 0) {
    return byStart;
  }
  if (left.lostOn === null || right.lostOn === null) {
    return left.lostOn === right.lostOn ? 0 : left.lostOn === null ? 1 : -1;
  }
  return compareDates(left.lostOn, right.lostOn);
}

/**
 * Rule (2): reigns of one title do not overlap. A reign covers `wonOn` up to (not including)
 * `lostOn`, so a title can change hands twice on one show: the old reign ends on the day the new
 * one starts, and a reign won and lost on the same day covers no time at all.
 */
function checkNoOverlap(view: WorldView): IntegrityIssue[] {
  const spansByTitle = new Map<string, ReignSpan[]>();
  for (const reign of tableOf(view, titleReignsTable).values()) {
    const spans = spansByTitle.get(reign.titleId) ?? [];
    spans.push({ id: reign.id, wonOn: reign.wonOn, lostOn: reign.lostOn });
    spansByTitle.set(reign.titleId, spans);
  }
  const issues: IntegrityIssue[] = [];
  for (const [titleId, spans] of spansByTitle) {
    spans.sort(compareSpans);
    let latest: ReignSpan | null = null;
    for (const span of spans) {
      if (
        latest !== null &&
        (latest.lostOn === null || compareDates(span.wonOn, latest.lostOn) < 0)
      ) {
        issues.push({
          code: 'titleReigns.overlap',
          table: 'titleReigns',
          id: span.id,
          message: `titleReigns ${span.id} (won ${span.wonOn}) overlaps ${latest.id} (${latest.wonOn} to ${latest.lostOn ?? 'now'}) on ${titleId}`,
        });
      }
      if (
        latest === null ||
        (latest.lostOn !== null &&
          (span.lostOn === null || compareDates(span.lostOn, latest.lostOn) > 0))
      ) {
        latest = span;
      }
    }
  }
  return issues;
}

export const titleReignsTable = defineTable({
  kind: 'titleReign',
  name: 'titleReigns',
  schema: TitleReignSchema,
  refs: [
    { path: 'titleId', target: 'title', nullable: false },
    { path: 'holderIds[]', target: 'person', nullable: false },
    { path: 'teamId', target: 'team', nullable: true },
    { path: 'wonInSegmentId', target: 'segment', nullable: true },
    { path: 'endedInSegmentId', target: 'segment', nullable: true },
  ],
  indexes: [
    { name: 'byTitle', key: (reign) => reign.titleId },
    { name: 'byHolder', key: (reign) => reign.holderIds },
    {
      name: 'openByTitle',
      key: (reign) => (reign.lostOn === null ? reign.titleId : null),
      unique: true,
    },
  ],
  invariants: [
    { name: 'holderCountMatchesTitle', check: checkHolderCounts },
    { name: 'reignsDoNotOverlap', check: checkNoOverlap },
  ],
});
