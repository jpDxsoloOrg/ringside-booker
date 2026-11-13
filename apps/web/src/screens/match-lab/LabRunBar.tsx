import { useId, useRef } from 'react';
import { FINISHES_REASON_CODES, parseContentKey } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { LAB_MAX_RUNS, useLabStore } from './labStore';
import type { LabState } from './labStore';
import type { LabRunner } from './useLabRunner';
import { runsText } from './labText';
import styles from './MatchLab.module.css';
import { useStickyBarRoom } from './useStickyBarRoom';

/** Why Run can't go yet, in player words, or null when it can. */
export function runBlocker(state: Pick<LabState, 'setup' | 'sides'>): string | null {
  if (state.setup.typeKey === null) return 'Pick a type first';
  if (state.setup.regionId === null) return 'Pick a region first';
  if (state.setup.promotionId === null) return 'Run a promotion to use the Match lab';
  if (state.sides.some((side) => side.length === 0)) return 'Add someone to every side';
  return null;
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
 * The lab's one action (MTCH2-07): Run, and a Runs slider from 1 to 100 beside it. A match always
 * plays out its winner and finish (from the Winner and finish group, Auto by default); a talking
 * segment is rated. Every Run rolls on a fresh seed, so pressing it again gives another night.
 *
 * Under the sides on desktop; on phones it sticks to the bottom of the screen, above the tab bar,
 * so it stays in reach while the line-up is built. The lab's other controls keep that much room
 * below them when scrolled to, so a focused control never hides under it (useStickyBarRoom).
 */
export function LabRunBar({ runner }: LabRunBarProps) {
  const setup = useLabStore((state) => state.setup);
  const sides = useLabStore((state) => state.sides);
  const runs = useLabStore((state) => state.runs);
  const setRuns = useLabStore((state) => state.setRuns);
  const pending = useLabStore((state) => state.pending);
  const refusal = useLabStore((state) => state.refusal);
  const reasonId = useId();
  const runsId = useId();
  const finishCatalogMessage = useFinishCatalogMessage(setup);
  const barRef = useRef<HTMLDivElement>(null);
  useStickyBarRoom(barRef);

  const blocker = runBlocker({ setup, sides });
  const described = blocker === null ? {} : { 'aria-describedby': reasonId };
  // A save from before finishes rates a match without a result; the Winner and finish group says why.
  const simulate = setup.kind === 'match' && finishCatalogMessage === null;

  return (
    <div ref={barRef} className={styles['runBar']}>
      <div className={styles['runControls']}>
        <Button
          variant="primary"
          iconStart="play"
          className={styles['runButton']}
          loading={pending}
          disabled={blocker !== null || pending}
          {...described}
          onClick={() => {
            void runner.run({ simulate });
          }}
        >
          Run
        </Button>
        <div className={styles['runsField']}>
          <label htmlFor={runsId} className={styles['runsLabel']}>
            Runs
          </label>
          <input
            id={runsId}
            type="range"
            className={styles['runsSlider']}
            min={1}
            max={LAB_MAX_RUNS}
            step={1}
            value={runs}
            aria-valuetext={runsText(runs)}
            onChange={(event) => {
              setRuns(event.currentTarget.valueAsNumber);
            }}
          />
          <output htmlFor={runsId} className={styles['runsValue']} aria-hidden="true">
            {runs}
          </output>
        </div>
      </div>
      {blocker !== null && (
        <p id={reasonId} className={styles['runReason']}>
          <Icon name="info" size="sm" decorative />
          {blocker}
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
