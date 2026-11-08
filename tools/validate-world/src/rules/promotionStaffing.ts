/**
 * `promotion-staffing`: every active promotion can put on a show on day one. It needs at least one
 * referee and one announcer under contract (error) and should have at least six wrestlers
 * (warning below that).
 */

import type { EmploymentRole } from '@ringside/engine';
import {
  activeEmployments,
  recordIssue,
  refKey,
  sortedRecords,
  worldStartDate,
  type ContentRule,
} from './helpers';

/** Fewest wrestlers a promotion should start with before the rule warns. */
export const MIN_WRESTLERS = 6;

/** Staff roles a promotion cannot run a show without. */
const REQUIRED_STAFF: readonly EmploymentRole[] = ['referee', 'announcer'];

export const promotionStaffing: ContentRule = {
  id: 'promotion-staffing',
  description: `Every active promotion employs at least one referee and one announcer, and should have ${String(MIN_WRESTLERS)} or more wrestlers`,
  check(world, content) {
    const start = worldStartDate(world);
    const rolesByPromotion = new Map<string, Map<EmploymentRole, number>>();
    for (const [, merged] of activeEmployments(content, start)) {
      const promotionKey = refKey(merged.record.promotionKey);
      const counts = rolesByPromotion.get(promotionKey) ?? new Map<EmploymentRole, number>();
      counts.set(merged.record.role, (counts.get(merged.record.role) ?? 0) + 1);
      rolesByPromotion.set(promotionKey, counts);
    }
    return sortedRecords(content, 'promotion').flatMap(([key, merged]) => {
      if (merged.record.status !== 'active') {
        return [];
      }
      const counts = rolesByPromotion.get(key);
      const issues = REQUIRED_STAFF.filter((role) => (counts?.get(role) ?? 0) === 0).map((role) =>
        recordIssue(
          'error',
          'promotion-staffing',
          'promotion',
          key,
          merged,
          [],
          `Active promotion ${key} has no ${role} under contract on ${start}`,
        ),
      );
      const wrestlers = counts?.get('wrestler') ?? 0;
      if (wrestlers < MIN_WRESTLERS) {
        issues.push(
          recordIssue(
            'warning',
            'promotion-staffing',
            'promotion',
            key,
            merged,
            [],
            `Active promotion ${key} has ${String(wrestlers)} wrestlers under contract on ${start}; at least ${String(MIN_WRESTLERS)} are needed to fill a card`,
          ),
        );
      }
      return issues;
    });
  },
};
