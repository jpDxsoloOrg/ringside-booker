/**
 * The rival desk's phases: the turn runner `aip.runTurns` and the decision log's daily prune.
 *
 * `aip.runTurns` (group `aiTurns`, so before contracts and shows) is the one phase every rival
 * behaviour runs through. For each computer unit in key order it makes sure the unit has a
 * profile, then runs every due job (`registerAiJob`) in id order, each inside its own savepoint:
 * a job that throws loses only its own work and the runner carries on with the next job and the
 * next unit. A failed job does not fail the step, so one broken rival job never stops the
 * player's skip; it is made visible instead, with a log line and an `aip.jobFailed` event (which
 * `npm run sim -- --strict` treats as a failure). A bug in the runner itself, outside any job,
 * still throws and fails the step as usual. See docs/design/rival-desk.md#jobs.
 */

import { dayOfMonth } from '../../core/date';
import type { PhaseContext } from '../../core/pipeline/context';
import { definePhase, type PhaseDefinition } from '../../core/pipeline/phase';
import { EntityNotFoundError } from '../../core/errors';
import type { AiProfile } from '../../model/entities/ai-profile';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { ensureProfile, profileOf } from './profiles';
import { createJobContext } from './jobs/context';
import { pruneDecisionLog, pruneDecisionLogOn } from './jobs/pruneDecisionLog';
import { aiJobs, jobRunsFor } from './jobs/registry';
import { isDue, unitShowsOn } from './jobs/spread';
import { computerUnits, type AiUnit } from './units';

export const AIP_RUN_TURNS_PHASE_ID = 'aip.runTurns';
export const AIP_PRUNE_DECISION_LOG_PHASE_ID = 'aip.pruneDecisionLog';

/** The longest failure message an `aip.jobFailed` event carries. */
const MAX_FAILURE_MESSAGE_LENGTH = 300;

/** The savepoint label of one job for one unit. */
export function jobSavepointLabel(jobId: string, unitKey: string): string {
  return `aip.job:${jobId}:${unitKey}`;
}

function requireProfile(read: GameWorldView, unit: AiUnit): DeepReadonly<AiProfile> {
  const profile = profileOf(read, unit.promotionId, unit.brandId);
  if (profile === null) {
    throw new EntityNotFoundError('aiProfiles', unit.key);
  }
  return profile;
}

/** Runs the due jobs of one unit. Returns the ids of the jobs that ran, failed ones included. */
function runUnitTurn(ctx: PhaseContext, unit: AiUnit): string[] {
  ensureProfile(ctx.tx, ctx.tx.view, unit, ctx.date);
  const due = aiJobs().filter(
    (job) => jobRunsFor(job, unit.brandId) && isDue(job.cadence, unit, ctx.date, ctx.tx.view),
  );
  if (due.length === 0) {
    return [];
  }
  const shows = unitShowsOn(ctx.tx.view, unit, ctx.date);
  for (const job of due) {
    const result = ctx.tx.savepoint(jobSavepointLabel(job.id, unit.key), (tx) => {
      const buffered = createJobContext(ctx, {
        jobId: job.id,
        tx,
        unit,
        profile: requireProfile(tx.view, unit),
        shows,
      });
      job.run(buffered.context);
      return buffered.flush;
    });
    if (result.ok) {
      result.value();
      continue;
    }
    const message = result.error.message.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
    ctx.log(`Rival job ${job.id} failed for ${unit.key} and was rolled back: ${message}`);
    ctx.publish('aip.jobFailed', {
      jobId: job.id,
      promotionId: unit.promotionId,
      brandId: unit.brandId,
      message,
    });
  }
  const jobIds = due.map((job) => job.id);
  ctx.tx.update('aiProfiles', requireProfile(ctx.tx.view, unit).id, { lastTurnOn: ctx.date });
  ctx.publish('aip.turnTaken', {
    promotionId: unit.promotionId,
    brandId: unit.brandId,
    date: ctx.date,
    jobIds,
  });
  return jobIds;
}

export const runTurnsPhase: PhaseDefinition = definePhase({
  id: AIP_RUN_TURNS_PHASE_ID,
  group: 'aiTurns',
  order: 50,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    let turns = 0;
    for (const unit of computerUnits(ctx.read)) {
      if (runUnitTurn(ctx, unit).length > 0) {
        turns += 1;
      }
    }
    if (turns > 0) {
      ctx.log(`${String(turns)} rival unit(s) took a turn`);
    }
  },
});

/**
 * Order 42 in `periodic`: after the aftermath prune (40), before the promotion popularity
 * history (45). Runs after `aip.runTurns`, so with a retention of 0 the day's own decisions go too.
 */
export const pruneDecisionLogPhase: PhaseDefinition = definePhase({
  id: AIP_PRUNE_DECISION_LOG_PHASE_ID,
  group: 'periodic',
  order: 42,
  cadence: { kind: 'daily' },
  run: (ctx) => {
    const retentionDays = ctx.tunables.get('aip.decisionLogRetentionDays');
    let pruned = pruneDecisionLogOn(ctx.tx, ctx.date, retentionDays);
    // Once a month, a full sweep catches rows a lowered retention or a failed day left behind.
    if (dayOfMonth(ctx.date) === 1) {
      pruned += pruneDecisionLog(ctx.tx, ctx.date, retentionDays);
    }
    if (pruned > 0) {
      ctx.log(`Pruned ${String(pruned)} rival decision(s) from the log`);
    }
  },
});

export const aipPhases: readonly PhaseDefinition[] = [runTurnsPhase, pruneDecisionLogPhase];
