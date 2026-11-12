import { useCallback } from 'react';
import type { GameDate, QueryArgs, QueryData, QueryName } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineClient } from '@/app/engine/EngineProvider';
import { LAB_BATCH_RUNS, previewArgsOf, simulateArgsOf, useLabStore } from './labStore';
import { outcomeHeadline } from './result/resultText';
import { seedText, statsSummary } from './labText';

/** Said when the engine could not be reached at all. */
const UNREACHABLE = 'The game engine did not answer. Try again.';

type Answer<K extends QueryName> =
  | { readonly ok: true; readonly data: QueryData<K> }
  | { readonly ok: false; readonly reasons: readonly string[] };

export interface LabRunner {
  /** Rates the segment once with the current seed. */
  readonly run: () => Promise<void>;
  /** Resolves the result plan and rates the match with its finish, with the current seed. */
  readonly simulate: () => Promise<void>;
  /** Moves to the next seed, then rates once (or simulates, when a Simulate is on screen). */
  readonly reroll: () => Promise<void>;
  /** Rates once and runs the same segment 100 times for the spread. */
  readonly runBatch: () => Promise<void>;
}

/**
 * The lab's Run, Simulate, Re-roll seed and Run x100. They ask the engine directly instead of through
 * `useEngineQuery`, so the answer stays on screen as it was, dated, after a Next Day: nothing
 * re-rolls behind the player's back. Answers that arrive after the lab was reset are dropped.
 */
export function useLabRunner(today: GameDate | null): LabRunner {
  const client = useEngineClient();
  const announce = useAnnounce();

  const ask = useCallback(
    async <K extends QueryName>(name: K, args: QueryArgs<K>): Promise<Answer<K>> => {
      try {
        const { result } = await client.query(name, args);
        return result.ok
          ? { ok: true, data: result.data }
          : { ok: false, reasons: result.reasons.map((reason) => reason.message) };
      } catch {
        return { ok: false, reasons: [UNREACHABLE] };
      }
    },
    [client],
  );

  const run = useCallback(async (): Promise<void> => {
    const store = useLabStore.getState();
    const args = previewArgsOf(store);
    if (args === null || store.pending !== null) return;
    const ticket = store.startRequest('run');
    const answer = await ask('match.preview', args);
    if (!answer.ok) {
      useLabStore.getState().failRequest(ticket, answer.reasons);
      return;
    }
    useLabStore.getState().finishRun(ticket, { args, result: answer.data, date: today });
    announce(`${seedText(args.previewSeed)}: score ${String(answer.data.score.value)}`);
  }, [announce, ask, today]);

  const simulate = useCallback(async (): Promise<void> => {
    const store = useLabStore.getState();
    const args = simulateArgsOf(store);
    if (args === null || store.pending !== null) return;
    const ticket = store.startRequest('simulate');
    const answer = await ask('match.simulate', args);
    if (!answer.ok) {
      useLabStore.getState().failRequest(ticket, answer.reasons);
      return;
    }
    useLabStore.getState().finishSimulation(ticket, { args, result: answer.data, date: today });
    announce(
      `${seedText(args.previewSeed)}: ${outcomeHeadline(answer.data)}, score ${String(answer.data.preview.score.value)}`,
    );
  }, [announce, ask, today]);

  const reroll = useCallback(async (): Promise<void> => {
    const store = useLabStore.getState();
    if (previewArgsOf(store) === null || store.pending !== null) return;
    const simulating = store.simulation !== null && simulateArgsOf(store) !== null;
    store.nextSeed();
    await (simulating ? simulate() : run());
  }, [run, simulate]);

  const runBatch = useCallback(async (): Promise<void> => {
    const store = useLabStore.getState();
    const args = previewArgsOf(store);
    if (args === null || store.pending !== null) return;
    const ticket = store.startRequest('batch');
    const batchArgs = { ...args, runs: LAB_BATCH_RUNS };
    const [single, batch] = await Promise.all([
      ask('match.preview', args),
      ask('match.previewBatch', batchArgs),
    ]);
    if (!single.ok || !batch.ok) {
      const reasons = [...(single.ok ? [] : single.reasons), ...(batch.ok ? [] : batch.reasons)];
      useLabStore.getState().failRequest(ticket, [...new Set(reasons)]);
      return;
    }
    const after = useLabStore.getState();
    // Both land under one ticket: the single night first (it clears an older batch), then the batch.
    after.finishRun(ticket, { args, result: single.data, date: today });
    after.finishBatch(ticket, { args: batchArgs, result: batch.data, date: today });
    announce(`${String(LAB_BATCH_RUNS)} runs: ${statsSummary(batch.data.score)}`);
  }, [announce, ask, today]);

  return { run, simulate, reroll, runBatch };
}
