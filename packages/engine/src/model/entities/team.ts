/**
 * Teams: tag teams and trios.
 *
 * Teams are global, not owned by a promotion: a team can move between companies, or work for
 * several, as a unit. Members are people, not employments, so a team survives its members changing
 * contracts.
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { zGameDate, zId, zStat } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf } from '../world';
import { isDeceased } from './people-lookup';
import { hasDuplicates } from './unique';

export const TEAM_KINDS = ['tag', 'trio'] as const;
export const TeamKindSchema = z.enum(TEAM_KINDS);
export type TeamKind = z.infer<typeof TeamKindSchema>;

/** How many members each kind of team has. */
export const TEAM_SIZE: Readonly<Record<TeamKind, number>> = { tag: 2, trio: 3 };

export const TEAM_STATUSES = ['active', 'inactive', 'split'] as const;
export const TeamStatusSchema = z.enum(TEAM_STATUSES);
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

export const TeamSchema = z
  .strictObject({
    id: zId('team'),
    kind: TeamKindSchema,
    name: z.string().min(1).max(60),
    memberIds: z.array(zId('person')),
    /** How well the team works together; feeds the teamwork bonus in matches. */
    experience: zStat,
    status: TeamStatusSchema,
    formedOn: zGameDate,
    /** The day the team split; set exactly when the status is `split`. */
    splitOn: zGameDate.nullable(),
  })
  .superRefine((team, context) => {
    const issue = (path: string[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    const size = TEAM_SIZE[team.kind];
    if (team.memberIds.length !== size) {
      issue(['memberIds'], `A ${team.kind} team has exactly ${String(size)} members`);
    }
    if (hasDuplicates(team.memberIds)) {
      issue(['memberIds'], 'Team members must be unique');
    }
    if (team.status === 'split' && team.splitOn === null) {
      issue(['splitOn'], 'splitOn is required when the team has split');
    }
    if (team.status !== 'split' && team.splitOn !== null) {
      issue(['splitOn'], 'splitOn must be null unless the team has split');
    }
    if (team.splitOn !== null && compareDates(team.splitOn, team.formedOn) < 0) {
      issue(['splitOn'], 'splitOn must not be before formedOn');
    }
  });

export type Team = z.infer<typeof TeamSchema>;

export const teamsTable = defineTable({
  kind: 'team',
  name: 'teams',
  schema: TeamSchema,
  refs: [{ path: 'memberIds[]', target: 'person', nullable: false }],
  indexes: [{ name: 'byMember', key: (team) => team.memberIds }],
  invariants: [
    {
      name: 'noDeceasedMembers',
      check(view): IntegrityIssue[] {
        const issues: IntegrityIssue[] = [];
        for (const team of tableOf(view, teamsTable).values()) {
          if (team.status !== 'active') {
            continue;
          }
          team.memberIds.forEach((memberId, memberIndex) => {
            if (isDeceased(view, memberId)) {
              issues.push({
                code: 'teams.deceasedMember',
                table: 'teams',
                id: team.id,
                path: `memberIds[${String(memberIndex)}]`,
                message: `Active team ${team.id} still lists deceased person ${memberId}`,
              });
            }
          });
        }
        return issues;
      },
    },
  ],
});
