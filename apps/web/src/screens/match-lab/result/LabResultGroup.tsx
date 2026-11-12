import { useCallback, useId } from 'react';
import type { ContentKey } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useLabStore } from '../labStore';
import { FinishSelect } from './FinishSelect';
import styles from './Result.module.css';
import { WinnerSelect } from './WinnerSelect';

/** The group's heading. */
export const RESULT_GROUP_TITLE = 'Winner and finish';

/** The names on each side, from what the picker knew about each person placed. */
function useSideNames(): readonly (readonly string[])[] {
  const sides = useLabStore((state) => state.sides);
  const people = useLabStore((state) => state.people);
  return sides.map((side) => side.map((personId) => people[personId]?.name ?? personId));
}

/**
 * The Match lab's Result group (MTCH2-04): Winner and Finish, what Simulate plays out. Shown for
 * a match only. Whether Auto means Random winners comes from `match.resultMode`; the web never
 * reads the world's settings itself.
 */
export interface LabResultGroupProps {
  /** True inside a panel that already carries the title (the phone layout): no heading or rule. */
  readonly bare?: boolean;
}

export function LabResultGroup({ bare = false }: LabResultGroupProps) {
  const setup = useLabStore((state) => state.setup);
  const plan = useLabStore((state) => state.result);
  const setWinner = useLabStore((state) => state.setWinner);
  const setFinish = useLabStore((state) => state.setFinish);
  const sideNames = useSideNames();
  const titleId = useId();
  const mode = useEngineQuery('match.resultMode', {});
  const randomWinners = mode.data?.randomWinners ?? false;
  const changeFinish = useCallback(
    (finishKey: ContentKey | null) => {
      setFinish(finishKey);
    },
    [setFinish],
  );

  if (setup.kind !== 'match' || setup.typeKey === null) return null;
  return (
    <section
      className={bare ? styles['bareGroup'] : styles['group']}
      aria-label={bare ? RESULT_GROUP_TITLE : undefined}
      aria-labelledby={bare ? undefined : titleId}
    >
      {!bare && (
        <h3 id={titleId} className={styles['groupTitle']}>
          {RESULT_GROUP_TITLE}
        </h3>
      )}
      <WinnerSelect
        sides={sideNames}
        value={plan.winner}
        randomWinners={randomWinners}
        onValueChange={setWinner}
      />
      <FinishSelect
        matchTypeKey={setup.typeKey}
        sideCount={Math.max(2, sideNames.length)}
        winner={plan.winner}
        value={plan.finishKey}
        onValueChange={changeFinish}
      />
    </section>
  );
}
