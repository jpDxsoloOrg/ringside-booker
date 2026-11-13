/**
 * What a rival job is handed: `AiJobContext`, and the buffer behind its `publish`,
 * `recordTrace` and `recordDecision`.
 *
 * A job runs inside its own savepoint (`phases.ts`). A savepoint rolls back rows but not staged
 * events or traces (`model/tx.ts`), so the job's `publish` and `recordTrace` do not write into the
 * phase's stagings straight away: they are buffered and flushed only when the savepoint returns
 * `ok: true`. A job that throws therefore leaves nothing behind: no rows, no events, no traces,
 * no decisions.
 *
 * `publish` and `recordTrace` keep `PhaseContext`'s exact signatures, so a job context can be
 * passed straight to the workers doors (`DoorContext`) and to the booking writer. See
 * docs/design/rival-desk.md#jobs.
 */

import type { AiDecisionId } from '../../../core/ids';
import type { PublishEvent } from '../../../core/events/bus';
import type { PhaseContext, StepContext } from '../../../core/pipeline/context';
import type { TraceStaging } from '../../../core/trace/store';
import type { AiProfile } from '../../../model/entities/ai-profile';
import type { EventInstance } from '../../../model/entities/event-instance';
import type { GameTables } from '../../../model/tables';
import type { Tx } from '../../../model/tx';
import type { DeepReadonly } from '../../../model/world';
import { writeAiDecision, type RecordDecisionSpec } from '../decisions';
import type { AiUnit } from '../units';

/** Everything a rival job gets for one unit on one day. */
export interface AiJobContext extends Pick<
  StepContext,
  'date' | 'tx' | 'read' | 'tunables' | 'rng' | 'publish' | 'recordTrace' | 'log'
> {
  /** The unit the job acts for. It must never write to a brand in `unit.excludedBrandIds`. */
  readonly unit: AiUnit;
  /** The unit's profile as it stands when the job starts (earlier jobs' changes included). */
  readonly profile: DeepReadonly<AiProfile>;
  /** The unit's open shows today, in ID order (what a `beforeShow` job plans for). */
  readonly shows: readonly DeepReadonly<EventInstance>[];
  /** Records a decision (`writeAiDecision`) and returns its ID. Buffered with the job's events. */
  readonly recordDecision: (spec: RecordDecisionSpec) => AiDecisionId;
}

/** A job context and the flush that hands its buffered events and traces to the phase. */
export interface BufferedJobContext {
  readonly context: AiJobContext;
  /** Passes every buffered `publish` and `recordTrace` to the phase, in the order they were made. */
  readonly flush: () => void;
}

/** What the runner knows about the job it is about to run. */
export interface JobRunSetup {
  readonly jobId: string;
  readonly tx: Tx<GameTables>;
  readonly unit: AiUnit;
  readonly profile: DeepReadonly<AiProfile>;
  readonly shows: readonly DeepReadonly<EventInstance>[];
}

/** Builds a job's context over the phase context `phase`, inside the job's savepoint `setup.tx`. */
export function createJobContext(phase: PhaseContext, setup: JobRunSetup): BufferedJobContext {
  const pending: (() => void)[] = [];
  const publish: PublishEvent = (type, payload) => {
    pending.push(() => {
      phase.publish(type, payload);
    });
  };
  const recordTrace: TraceStaging['record'] = (ref, date, traced, options) => {
    pending.push(() => {
      phase.recordTrace(ref, date, traced, options);
    });
  };
  const base = {
    date: phase.date,
    tx: setup.tx,
    read: setup.tx.view,
    tunables: phase.tunables,
    rng: phase.rng,
    publish,
    recordTrace,
  };
  const context: AiJobContext = {
    ...base,
    log: (message) => {
      phase.log(`${setup.jobId} ${setup.unit.key}: ${message}`);
    },
    unit: setup.unit,
    profile: setup.profile,
    shows: setup.shows,
    recordDecision: (spec) => writeAiDecision(setup.tx, base, setup.unit, spec),
  };
  return {
    context,
    flush: () => {
      for (const deliver of pending) {
        deliver();
      }
      pending.length = 0;
    },
  };
}
