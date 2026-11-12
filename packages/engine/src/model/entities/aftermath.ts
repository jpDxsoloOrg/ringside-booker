/**
 * Aftermaths: what one match did to one competitor's popularity and momentum (MTCH3-03).
 *
 * Show night writes one row per competitor per match it runs (`applySegmentAftermath` in
 * `systems/match/aftermath/apply.ts`), with the before and after values the doors actually wrote.
 * Results pages and Recent form read these rows, so they agree with the profile even after the
 * full Why? trace has been pruned from the recent-traces store. A weekly phase keeps only each
 * worker's newest `match.aftermath.keepPerPerson` rows.
 *
 * `popularity.byRegion` is sparse: only the regions the change reached. Momentum is null when the
 * competitor had no contract with the show's promotion; its `before` is null when this match was
 * their first appearance under the contract (the door started it).
 *
 * Design: docs/design/data-model.md#aftermaths-aftermaths-aft_ and
 * docs/design/match-aftermath.md#stored-aftermaths.
 */

import { z } from 'zod';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { eventInstancesTable } from './event-instance';
import { segmentsTable } from './segment';

export const AFTERMATH_OUTCOMES = ['win', 'loss', 'draw'] as const;
export type AftermathOutcome = (typeof AFTERMATH_OUTCOMES)[number];

const zPopularity = z.number().min(0).max(100);
const zMomentum = z.number().min(-100).max(100);

export const AftermathRegionSchema = z.strictObject({
  before: zPopularity,
  after: zPopularity,
});

export const AftermathSchema = z.strictObject({
  id: zId('aftermath'),
  segmentId: zId('segment'),
  eventInstanceId: zId('eventInstance'),
  promotionId: zId('promotion'),
  personId: zId('person'),
  date: zGameDate,
  outcome: z.enum(AFTERMATH_OUTCOMES),
  showRegionId: zId('region'),
  popularity: z.strictObject({
    /** The change the match asked for in the show's region, before the door's spread and taper. */
    delta: z.number(),
    /** Only the regions the change reached. */
    byRegion: z.record(zId('region'), AftermathRegionSchema),
  }),
  momentum: z
    .strictObject({
      employmentId: zId('employment'),
      /** Null when this match started the momentum (first appearance under the contract). */
      before: zMomentum.nullable(),
      after: zMomentum,
    })
    .nullable(),
  /** `refKey`s of the `match.popularityGain` and `match.momentumGain` traces. */
  traceIds: z.strictObject({
    popularity: z.string().min(1),
    momentum: z.string().min(1).nullable(),
  }),
});

export type AftermathRegion = z.infer<typeof AftermathRegionSchema>;
export type Aftermath = z.infer<typeof AftermathSchema>;

/** The key of the unique `bySegmentPerson` index. */
export function aftermathSegmentPersonKey(segmentId: string, personId: string): string {
  return `${segmentId}|${personId}`;
}

/** A row's show and promotion are its segment's. */
function checkMatchesSegment(view: WorldView): IntegrityIssue[] {
  const segments = tableOf(view, segmentsTable);
  const instances = tableOf(view, eventInstancesTable);
  const issues: IntegrityIssue[] = [];
  for (const row of tableOf(view, aftermathsTable).values()) {
    const segment = segments.get(row.segmentId);
    if (segment === undefined) {
      continue;
    }
    if (segment.eventInstanceId !== row.eventInstanceId) {
      issues.push({
        code: 'aftermaths.showMismatch',
        table: 'aftermaths',
        id: row.id,
        path: 'eventInstanceId',
        message: `aftermath ${row.id} names show ${row.eventInstanceId} but its segment is on ${segment.eventInstanceId}`,
      });
      continue;
    }
    const instance = instances.get(row.eventInstanceId);
    if (instance !== undefined && instance.promotionId !== row.promotionId) {
      issues.push({
        code: 'aftermaths.promotionMismatch',
        table: 'aftermaths',
        id: row.id,
        path: 'promotionId',
        message: `aftermath ${row.id} names promotion ${row.promotionId} but its show is run by ${instance.promotionId}`,
      });
    }
  }
  return issues;
}

export const aftermathsTable = defineTable({
  kind: 'aftermath',
  name: 'aftermaths',
  schema: AftermathSchema,
  refs: [
    { path: 'segmentId', target: 'segment', nullable: false },
    { path: 'eventInstanceId', target: 'eventInstance', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'personId', target: 'person', nullable: false },
    { path: 'showRegionId', target: 'region', nullable: false },
    { path: 'popularity.byRegion{}', target: 'region', nullable: false },
    { path: 'momentum.employmentId', target: 'employment', nullable: false },
  ],
  indexes: [
    { name: 'bySegment', key: (row) => row.segmentId },
    { name: 'byPerson', key: (row) => row.personId },
    { name: 'byEventInstance', key: (row) => row.eventInstanceId },
    {
      name: 'bySegmentPerson',
      key: (row) => aftermathSegmentPersonKey(row.segmentId, row.personId),
      unique: true,
    },
  ],
  invariants: [{ name: 'matchesSegment', check: checkMatchesSegment }],
});
