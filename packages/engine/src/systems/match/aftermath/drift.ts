/**
 * The weekly momentum drift (MTCH3-07): every Monday, each open employment with a momentum moves
 * `match.momentum.weeklyDrift` of the way back to `match.momentum.driftTarget`, through WRK1's
 * momentum door (`applyMomentumChange`), so the limits, the door trace and the `momentum.changed`
 * event are the same as for every other change. One change per employment per week.
 *
 * Traces are kept lean, since the save is already large: a human-run promotion's workers give the
 * door the full drift breakdown (`momentumDrift`), so their Why? shows every step; a rival's
 * workers give it the plain number with the same line ("Cooling off: 12% of the way back to 0"),
 * which is all a summary keeps anyway. Rivals are applied first so that, inside the door's trace
 * kind, the player's workers are the newest and keep their full trace.
 *
 * Empty momentum (no appearance yet) stays empty, and nothing here reads or writes morale: cooling
 * off is never held against anyone (D-09).
 *
 * Design: docs/design/match-aftermath.md#momentum-drift.
 */

import { definePhase, type PhaseDefinition } from '../../../core/pipeline/phase';
import type { Employment } from '../../../model/entities/employment';
import { ENDED_EMPLOYMENT_STATUSES } from '../../../model/entities/employment';
import type { GameWorldView } from '../../../model/tables';
import type { DeepReadonly } from '../../../model/world';
import { showControllerOf } from '../../calendar/control';
import { applyMomentumChange, type DoorContext } from '../../workers/doors';
import { driftShare, momentumDrift, momentumDriftLabel } from './formulas/momentumDrift';

export const MOMENTUM_DRIFT_PHASE_ID = 'match.momentumDrift';
/** Before the aftermath prune (40) in the `periodic` group; both run on Mondays. */
export const MOMENTUM_DRIFT_PHASE_ORDER = 30;
/** The door reason key every drift step carries. */
export const MOMENTUM_DRIFT_REASON_KEY = 'momentum.drift';

/** One employment that drifts this week. */
export interface DriftingEmployment {
  readonly employment: DeepReadonly<Employment>;
  /** True when a human runs it: its door trace keeps the full drift breakdown. */
  readonly human: boolean;
}

function isOpen(employment: DeepReadonly<Employment>): boolean {
  return !ENDED_EMPLOYMENT_STATUSES.some((ended) => ended === employment.status);
}

/**
 * The open employments with a momentum away from the target, rivals first, then the human-run
 * ones; each part in ID order.
 */
export function driftingEmployments(read: GameWorldView, target: number): DriftingEmployment[] {
  const rivals: DriftingEmployment[] = [];
  const humans: DriftingEmployment[] = [];
  // Table iteration is in ascending ID order.
  for (const employment of read.tables.employments.values()) {
    if (!isOpen(employment) || employment.momentum === null || employment.momentum === target) {
      continue;
    }
    const human =
      showControllerOf(read, { promotionId: employment.promotionId, brandId: employment.brandId })
        .kind === 'human';
    (human ? humans : rivals).push({ employment, human });
  }
  return [...rivals, ...humans];
}

/** Applies one week of drift to every drifting employment. Returns how many changed. */
export function applyMomentumDrift(step: DoorContext): number {
  const { tunables } = step;
  const weekly = tunables.get('match.momentum.weeklyDrift');
  if (weekly === 0) {
    return 0;
  }
  const target = tunables.get('match.momentum.driftTarget');
  const share = driftShare(weekly);
  let changed = 0;
  for (const { employment, human } of driftingEmployments(step.read, target)) {
    const before = employment.momentum;
    if (before === null) {
      continue;
    }
    const drift = momentumDrift({ before }, { tunables });
    const result = applyMomentumChange(step, {
      employmentId: employment.id,
      delta: human ? drift : drift.value,
      source: 'system',
      reason: {
        key: MOMENTUM_DRIFT_REASON_KEY,
        label: momentumDriftLabel(before, target, share),
      },
    });
    if (result.changed) {
      changed += 1;
    }
  }
  return changed;
}

export const momentumDriftPhase: PhaseDefinition = definePhase({
  id: MOMENTUM_DRIFT_PHASE_ID,
  group: 'periodic',
  order: MOMENTUM_DRIFT_PHASE_ORDER,
  cadence: { kind: 'weekly', weekday: 'mon' },
  run: (ctx) => {
    applyMomentumDrift(ctx);
  },
});
