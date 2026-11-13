/**
 * Injuries (WRK6-03): every injury a person has had, one row each.
 *
 * `returnedOn === null` marks the current injury, and the unique `openByPerson` index allows only
 * one of those per person (the WRK6 rule: at most one current injury). The person row keeps a copy
 * of the current one in `person.injury`, which the rest of the game reads; the `injuries` table is
 * the history. Only `health.injure` (`systems/health/injure.ts`) inserts rows or sets the pointer,
 * and only the daily return step (`health.recovery`) closes them.
 *
 * Rows are small and are part of a worker's record, so they are kept for good; the traces behind
 * an injury's Why? are slimmed to summaries past `history.keepDetailDays` like other traces.
 *
 * Design: docs/design/data-model.md, "Injuries", and docs/design/health.md#injuries.
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import { INJURY_SEVERITIES } from '../catalogs';
import type { IntegrityIssue } from '../integrity';
import { zContentKey, zGameDate, zId } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { isPresentIff } from './entity-refinements';
import { BodyPartSchema, peopleTable } from './person';

export const InjurySeveritySchema = z.enum(INJURY_SEVERITIES);

/** Where an injury came from: an off-screen world event, or a segment on a show. */
export const INJURY_SOURCES = ['world', 'segment'] as const;
export type InjurySource = (typeof INJURY_SOURCES)[number];
export const InjurySourceSchema = z.enum(INJURY_SOURCES);

export const InjuryRecordSchema = z
  .strictObject({
    id: zId('injury'),
    personId: zId('person'),
    /** The injury catalog entry, such as `injury.torn-acl`. */
    kindKey: zContentKey,
    bodyPart: BodyPartSchema,
    severity: InjurySeveritySchema,
    since: zGameDate,
    expectedReturn: zGameDate,
    /** The day they came back; null while this is their current injury. */
    returnedOn: zGameDate.nullable(),
    source: InjurySourceSchema,
    /** The segment they were hurt in. Set exactly when `source` is `segment`. */
    segmentId: zId('segment').nullable(),
    /** Can still appear in talking segments while injured. */
    canWorkAngles: z.boolean(),
    /** Condition the hurt body part lost, 0 to 100 points. */
    conditionLoss: z.number().min(0).max(100),
    /** The day their promotion found out (the own-injury gate, WRK6-04); null until then. */
    noticedOn: zGameDate.nullable(),
  })
  .refine((injury) => compareDates(injury.expectedReturn, injury.since) >= 0, {
    message: 'expectedReturn must not be before since',
    path: ['expectedReturn'],
  })
  .refine(
    (injury) => injury.returnedOn === null || compareDates(injury.returnedOn, injury.since) >= 0,
    {
      message: 'returnedOn must not be before since',
      path: ['returnedOn'],
    },
  )
  .refine((injury) => isPresentIff(injury.segmentId, injury.source === 'segment'), {
    message: 'segmentId is set exactly when source is segment',
    path: ['segmentId'],
  });

export type InjuryRecord = z.infer<typeof InjuryRecordSchema>;

/**
 * Every current injury row has a matching pointer on its person: the same kind, body part and
 * expected return. The converse is not checked, so a save made before this table (where a person
 * may have an injury and no row) still loads.
 */
function checkOpenInjuryMatchesPerson(view: WorldView): IntegrityIssue[] {
  const people = tableOf(view, peopleTable);
  const issues: IntegrityIssue[] = [];
  for (const injury of tableOf(view, injuriesTable).values()) {
    if (injury.returnedOn !== null) {
      continue;
    }
    const pointer = people.get(injury.personId)?.injury ?? null;
    if (
      pointer !== null &&
      pointer.kindKey === injury.kindKey &&
      pointer.bodyPart === injury.bodyPart &&
      pointer.expectedReturn === injury.expectedReturn
    ) {
      continue;
    }
    issues.push({
      code: 'injuries.openInjuryMatchesPerson',
      table: 'injuries',
      id: injury.id,
      path: 'personId',
      message: `injuries ${injury.id}: ${injury.personId}'s current injury does not match this open row (${injury.kindKey}, ${injury.bodyPart}, back ${injury.expectedReturn})`,
    });
  }
  return issues;
}

export const injuriesTable = defineTable({
  kind: 'injury',
  name: 'injuries',
  schema: InjuryRecordSchema,
  refs: [
    { path: 'personId', target: 'person', nullable: false },
    { path: 'segmentId', target: 'segment', nullable: true },
  ],
  indexes: [
    { name: 'byPerson', key: (injury) => injury.personId },
    {
      name: 'openByPerson',
      key: (injury) => (injury.returnedOn === null ? injury.personId : null),
      unique: true,
    },
    {
      name: 'awaitingNotice',
      key: (injury) => (injury.noticedOn === null ? 'pending' : null),
    },
  ],
  invariants: [{ name: 'openInjuryMatchesPerson', check: checkOpenInjuryMatchesPerson }],
});
