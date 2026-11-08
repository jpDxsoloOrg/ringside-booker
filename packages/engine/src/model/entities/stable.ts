/**
 * Stables: factions of two to twelve people inside one promotion.
 *
 * Unlike teams, a stable belongs to a promotion: it is a creative device of that company. Members
 * are people, and they are not required to hold a contract with the stable's promotion (someone
 * can be between deals); what happens to the stable then is a creative decision, not a data rule.
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zImageRef } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf } from '../world';
import { isDeceased } from './people-lookup';
import { hasDuplicates } from './unique';

export const STABLE_MIN_MEMBERS = 2;
export const STABLE_MAX_MEMBERS = 12;

export const STABLE_STATUSES = ['active', 'disbanded'] as const;
export const StableStatusSchema = z.enum(STABLE_STATUSES);
export type StableStatus = z.infer<typeof StableStatusSchema>;

export const StableSchema = z
  .strictObject({
    id: zId('stable'),
    promotionId: zId('promotion'),
    name: z.string().min(1).max(60),
    memberIds: z.array(zId('person')).min(STABLE_MIN_MEMBERS).max(STABLE_MAX_MEMBERS),
    /** The stable's leader, who must be a member; null for a stable of equals. */
    leaderId: zId('person').nullable(),
    status: StableStatusSchema,
    formedOn: zGameDate,
    /** The day the stable disbanded; set exactly when the status is `disbanded`. */
    disbandedOn: zGameDate.nullable(),
    imageRef: zImageRef,
  })
  .superRefine((stable, context) => {
    const issue = (path: string[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    if (hasDuplicates(stable.memberIds)) {
      issue(['memberIds'], 'Stable members must be unique');
    }
    if (stable.leaderId !== null && !stable.memberIds.includes(stable.leaderId)) {
      issue(['leaderId'], 'The leader must be one of the members');
    }
    if (stable.status === 'disbanded' && stable.disbandedOn === null) {
      issue(['disbandedOn'], 'disbandedOn is required when the stable has disbanded');
    }
    if (stable.status !== 'disbanded' && stable.disbandedOn !== null) {
      issue(['disbandedOn'], 'disbandedOn must be null unless the stable has disbanded');
    }
    if (stable.disbandedOn !== null && compareDates(stable.disbandedOn, stable.formedOn) < 0) {
      issue(['disbandedOn'], 'disbandedOn must not be before formedOn');
    }
  });

export type Stable = z.infer<typeof StableSchema>;

export const stablesTable = defineTable({
  kind: 'stable',
  name: 'stables',
  schema: StableSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'memberIds[]', target: 'person', nullable: false },
    { path: 'leaderId', target: 'person', nullable: true },
  ],
  indexes: [
    { name: 'byPromotion', key: (stable) => stable.promotionId },
    { name: 'byMember', key: (stable) => stable.memberIds },
  ],
  invariants: [
    {
      name: 'noDeceasedMembers',
      check(view): IntegrityIssue[] {
        const issues: IntegrityIssue[] = [];
        for (const stable of tableOf(view, stablesTable).values()) {
          if (stable.status !== 'active') {
            continue;
          }
          stable.memberIds.forEach((memberId, memberIndex) => {
            if (isDeceased(view, memberId)) {
              issues.push({
                code: 'stables.deceasedMember',
                table: 'stables',
                id: stable.id,
                path: `memberIds[${String(memberIndex)}]`,
                message: `Active stable ${stable.id} still lists deceased person ${memberId}`,
              });
            }
          });
        }
        return issues;
      },
    },
  ],
});
