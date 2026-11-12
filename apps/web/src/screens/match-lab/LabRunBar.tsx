import { useId } from 'react';
import { FINISHES_REASON_CODES, parseContentKey } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { LAB_BATCH_RUNS, useLabStore } from './labStore';
import type { LabState } from './labStore';
import type { LabRunner } from './useLabRunner';
import { seedText } from './labText';
import styles from './MatchLab.module.css';

/** Why Run can't go yet, in player words, or null when it can. */
export function runBlocker(state: Pick<LabState, 'setup' | 'sides'>): string | null {
  if (state.setup.typeKey === null) return 'Pick a type first';
  if (state.setup.regionId === null) return 'Pick a region first';
  if (state.setup.promotionId === null) return 'Run a promotion to use the Match lab';
  if (state.sides.some((side) => side.length === 0)) return 'Add someone to every side';
  return null;
}

/**
 * Why Simulate can't go yet, or null when it can: Run's reasons first, then a save with no finish
 * catalog (the Result group says the same).
 */
export function simulateBlocker(
  state: Pick<LabState, 'setup' | 'sides'>,
  finishCatalogMessage: string | null,
): string | null {
  return runBlocker(state) ?? finishCatalogMessage;
}

/** Stands in for the match type while there is none; the query is not sent then. */
const UNASKED_TYPE = parseContentKey('match.singles');

/** The engine's "no finish catalog" message for this match type, or null. */
function useFinishCatalogMessage(setup: LabState['setup']): string | null {
  const isMatch = setup.kind === 'match' && setup.typeKey !== null;
  const finishes = useEngineQuery(
    'match.finishes',
    { matchTypeKey: setup.typeKey ?? UNASKED_TYPE },
    { enabled: isMatch },
  );
  if (!isMatch || finishes.error?.kind !== 'rejected') return null;
  const reason = finishes.error.reasons.find(
    (entry) => entry.code === FINISHES_REASON_CODES.noFinishCatalog,
  );
  return reason?.message ?? null;
}

export interface LabRunBarProps {
  readonly runner: LabRunner;
}

/**
 * Run, Simulate (matches only), Re-roll seed and Run x100. Under the sides on desktop; on phones it sticks to the bottom of
 * the screen, above the tab bar, so it stays in reach while the line-up is built.
 */
export function LabRunBar({ runner }: LabRunBarProps) {
  const setup = useLabStore((state) => state.setup);
  const sides = useLabStore((state) => state.sides);
  const previewSeed = useLabStore((state) => state.previewSeed);
  const pending = useLabStore((state) => state.pending);
  const refusal = useLabStore((state) => state.refusal);
  const reasonId = useId();
  const simulateReasonId = useId();
  const finishCatalogMessage = useFinishCatalogMessage(setup);

  const blocker = runBlocker({ setup, sides });
  const disabled = blocker !== null || pending !== null;
  const described = blocker === null ? {} : { 'aria-describedby': reasonId };
  const canSimulate = setup.kind === 'match';
  const simulateReason = simulateBlocker({ setup, sides }, finishCatalogMessage);
  const simulateDescribed =
    simulateReason === null
      ? {}
      : { 'aria-describedby': simulateReason === blocker ? reasonId : simulateReasonId };

  return (
    <div className={styles['runBar']}>
      <div className={styles['runButtons']} data-buttons={canSimulate ? 4 : 3}>
        <Button
          variant="primary"
          iconStart="play"
          loading={pending === 'run'}
          disabled={disabled}
          {...described}
          onClick={() => {
            void runner.run();
          }}
        >
          Run
        </Button>
        {canSimulate && (
          <Button
            iconStart="trophy"
            loading={pending === 'simulate'}
            disabled={simulateReason !== null || pending !== null}
            {...simulateDescribed}
            onClick={() => {
              void runner.simulate();
            }}
          >
            Simulate
          </Button>
        )}
        <Button
          iconStart="reset"
          disabled={disabled}
          {...described}
          onClick={() => {
            void runner.reroll();
          }}
        >
          Re-roll seed
        </Button>
        <Button
          iconStart="fast-forward"
          loading={pending === 'batch'}
          disabled={disabled}
          {...described}
          onClick={() => {
            void runner.runBatch();
          }}
        >
          Run x{LAB_BATCH_RUNS}
        </Button>
        <span className={styles['seed']}>{seedText(previewSeed)}</span>
      </div>
      {blocker !== null && (
        <p id={reasonId} className={styles['runReason']}>
          <Icon name="info" size="sm" decorative />
          {blocker}
        </p>
      )}
      {canSimulate && blocker === null && simulateReason !== null && (
        <p id={simulateReasonId} className={styles['runReason']}>
          <Icon name="info" size="sm" decorative />
          {simulateReason}
        </p>
      )}
      {refusal.length > 0 && (
        <div className={styles['refusal']} role="alert">
          {refusal.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </div>
  );
}
