import { useCallback } from 'react';
import type { GameDate, QueryArgs, QueryData, QueryName } from '@ringside/engine';
import { PREVIEW_SEED_MAX } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { useEngineClient } from '@/app/engine/EngineProvider';
import { freshSeed, labExtensionsOf, previewArgsOf, simulateArgsOf, useLabStore } from './labStore';
import type { LabRun } from './labStore';
import { outcomeHeadline } from './result/resultText';
import { statsSummary } from './labText';

/** Said when the engine could not be reached at all. */
const UNREACHABLE = 'The game engine did not answer. Try again.';

type Refusable =
  { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

type Answer<K extends QueryName> =
  | { readonly ok: true; readonly data: QueryData<K> }
  | { readonly ok: false; readonly reasons: readonly string[] };

/** The reasons of every refused answer, each once. */
function reasonsOf(answers: readonly (Refusable | null)[]): string[] {
  return [
    ...new Set(answers.flatMap((answer) => (answer === null || answer.ok ? [] : answer.reasons))),
  ];
}

/** What the screen reader hears when a Run lands. */
function announcement(run: LabRun): string {
  const score = `score ${String(run.rating.score.value)}`;
  const night = run.simulation === null ? score : `${outcomeHeadline(run.simulation)}, ${score}`;
  if (run.batch === null) return night;
  return `${String(run.runs)} runs: ${statsSummary(run.batch.score)}. Last run: ${night}`;
}

/** How a Run plays out: `simulate` for a match with finishes, else rating only. */
export interface LabRunOptions {
  readonly simulate: boolean;
  /**
   * Plays the same nights again on the seed of the Run on screen instead of a fresh one, so a
   * what-if (MTCH4-05's "Fatigue going in") changes only what it changes. A fresh seed when nothing
   * has run yet.
   */
  readonly sameSeed?: boolean;
}

export interface LabRunner {
  /**
   * Plays out Runs nights on a fresh seed. A match is simulated (winner and finish from the plan)
   * when `simulate` is true; a talking segment, or a match on a save with no finishes, is rated.
   */
  readonly run: (options: LabRunOptions) => Promise<void>;
}

/**
 * The lab's Run (MTCH2-07). Every Run picks a fresh seed: night `i` rolls with the seed plus `i`,
 * and the night shown in full is the last one, so it is one of the nights the batch counted. It
 * asks the engine directly instead of through `useEngineQuery`, so the answer stays on screen as it
 * was, dated, after a Next Day: nothing re-rolls behind the player's back. Answers that arrive
 * after the lab was reset, or after a newer Run, are dropped.
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

  const run = useCallback(
    async ({ simulate, sameSeed = false }: LabRunOptions): Promise<void> => {
      const store = useLabStore.getState();
      if (store.pending) return;
      const { runs, lastRun } = store;
      const seed =
        sameSeed && lastRun !== null
          ? Math.min(
              Math.max(0, lastRun.args.previewSeed - (lastRun.runs - 1)),
              PREVIEW_SEED_MAX - (runs - 1),
            )
          : freshSeed(runs);
      const args = previewArgsOf(store, seed + runs - 1);
      if (args === null) return;
      const ticket = store.startRequest();
      const batched = runs > 1;

      let landed: LabRun;
      if (simulate && args.kind === 'match') {
        const plan = store.result;
        // Every match Run carries the Physical panel's toll (MTCH4-05): one round-trip per Run.
        const simulateArgs = { ...simulateArgsOf(args, plan), extensions: labExtensionsOf(store) };
        const [single, batch] = await Promise.all([
          ask('match.simulate', simulateArgs),
          batched
            ? ask('match.simulateBatch', { ...simulateArgs, previewSeed: seed, runs })
            : Promise.resolve(null),
        ]);
        if (!single.ok || (batch !== null && !batch.ok)) {
          useLabStore.getState().failRequest(ticket, reasonsOf([single, batch]));
          return;
        }
        landed = {
          args,
          plan,
          rating: single.data.preview,
          simulation: single.data,
          runs,
          batch: batch?.data ?? null,
          date: today,
        };
      } else {
        const [single, batch] = await Promise.all([
          ask('match.preview', args),
          batched
            ? ask('match.previewBatch', { ...args, previewSeed: seed, runs })
            : Promise.resolve(null),
        ]);
        if (!single.ok || (batch !== null && !batch.ok)) {
          useLabStore.getState().failRequest(ticket, reasonsOf([single, batch]));
          return;
        }
        landed = {
          args,
          plan: null,
          rating: single.data,
          simulation: null,
          runs,
          batch: batch?.data ?? null,
          date: today,
        };
      }
      useLabStore.getState().finishRun(ticket, landed);
      announce(announcement(landed));
    },
    [announce, ask, today],
  );

  return { run };
}
