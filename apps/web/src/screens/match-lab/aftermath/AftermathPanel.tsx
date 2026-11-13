/**
 * The Match lab's Aftermath panel (MTCH3-04): what the result on screen would do to every
 * competitor's popularity and momentum, from the `aftermath` of the last `match.simulate`. It
 * reads only what the lab already has (the Run's answer and `match.labOptions`), so it never asks
 * the engine for anything of its own, morale least of all.
 */
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import type { LabPanelContext } from '../labPanelRegistry';
import { isOutOfDate, useLabStore } from '../labStore';
import { AFTERMATH_EMPTY_BODY } from './aftermathText';
import { AftermathView } from './AftermathView';
import { useAftermathViewStore } from './aftermathViewStore';

/** The promotion name the no-contract note uses when the lab has none to give. */
const FALLBACK_PROMOTION_NAME = 'this promotion';

export interface AftermathPanelProps {
  readonly simulation: LabPanelContext['simulation'];
}

/** The panel's body: an empty state before the first Run, else the aftermath. */
export function AftermathPanel({ simulation }: AftermathPanelProps) {
  const level = useAftermathViewStore((state) => state.level);
  const setLevel = useAftermathViewStore((state) => state.setLevel);
  const stale = useLabStore((state) =>
    isOutOfDate(
      { setup: state.setup, sides: state.sides, result: state.result, crew: state.crew },
      state.lastRun,
    ),
  );
  // Already asked for by the lab itself, so this is answered from the cache.
  const options = useEngineQuery('match.labOptions', {});
  const promotionName = options.data?.promotion?.name ?? FALLBACK_PROMOTION_NAME;

  if (simulation === null) {
    return (
      <EmptyState icon="lab" headingLevel={3} title="Nothing run yet" body={AFTERMATH_EMPTY_BODY} />
    );
  }
  if (simulation.aftermath.workers.length === 0) {
    return (
      <EmptyState
        icon="lab"
        headingLevel={3}
        title="Nobody to show"
        body="This result changes nobody's popularity or momentum."
      />
    );
  }
  return (
    <AftermathView
      aftermath={simulation.aftermath}
      promotionName={promotionName}
      level={level}
      onLevelChange={setLevel}
      stale={stale}
    />
  );
}
