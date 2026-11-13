/**
 * The rival desk's domain events. IDs and primitives only. See
 * docs/design/day-pipeline.md#domain-events and docs/design/rival-desk.md#jobs.
 */

import type { GameDate } from '../../core/date';
import type { AiDecisionId, BrandId, PromotionId } from '../../core/ids';

declare module '../../core/events/types' {
  interface DomainEventMap {
    /** A computer unit took its turn: at least one rival job was due and ran (or failed). */
    'aip.turnTaken': {
      promotionId: PromotionId;
      brandId: BrandId | null;
      date: GameDate;
      /** The jobs that ran, in the order they ran (by id), failed ones included. */
      jobIds: string[];
    };
    /** A rival job recorded a decision in the `aiDecisions` log. */
    'aip.decisionRecorded': {
      decisionId: AiDecisionId;
      promotionId: PromotionId;
      brandId: BrandId | null;
      kind: string;
      revealOn: GameDate;
      importance: number;
    };
    /** A rival job threw; its savepoint rolled back everything it did. */
    'aip.jobFailed': {
      jobId: string;
      promotionId: PromotionId;
      brandId: BrandId | null;
      message: string;
    };
  }
}

export {};
