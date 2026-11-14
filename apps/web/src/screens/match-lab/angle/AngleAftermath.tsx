/**
 * The Match lab's Aftermath panel in Angle mode (MTCH5-06): what the angle on screen would do to
 * the momentum and popularity of everyone in its beats, from the `aftermath` of the last
 * `match.previewAngle` Run. Each change has its Why?; nothing here mentions morale (D-09), because
 * an angle never changes it.
 */
import type { AngleAftermathWorker } from '@ringside/engine';
import { hasMomentum } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { DeltaChip } from '@/components/DeltaChip';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { WhyButton } from '@/components/Trace';
import {
  momentumChangeText,
  momentumText,
  noContractText,
  popularityChangeText,
  popularityText,
} from '../aftermath/aftermathText';
import styles from '../aftermath/AftermathPanel.module.css';
import type { AngleLabState } from './useAngleLab';

export const ANGLE_AFTERMATH_TITLE = 'Aftermath';

/** The empty state before the first Run. */
export const ANGLE_AFTERMATH_EMPTY_BODY =
  'Run the angle to see what it would do to the momentum and popularity of everyone in it.';

/** Under the table: how the numbers are worked out, in plain words. */
export const ANGLE_AFTERMATH_NOTE =
  'A good angle builds momentum and a little popularity; a flat one costs a little momentum. Each person gets their share of the beats they are in. Popularity never drops from an angle.';

/** The note when the angle changed after the Run on screen. */
export const ANGLE_AFTERMATH_STALE_TEXT = 'The angle changed: run again to update these numbers.';

const FALLBACK_PROMOTION_NAME = 'this promotion';

function columns(regionName: string, promotionName: string): ColumnDef<AngleAftermathWorker>[] {
  return [
    { id: 'name', header: 'Person', cell: (row) => row.name, card: 'title' },
    { id: 'share', header: 'Beats', cell: (row) => row.shareText, card: 'subtitle' },
    {
      id: 'popularity',
      header: `Popularity in ${regionName}`,
      cell: (row) => {
        const change = row.popularity.delta.value;
        return (
          <span className={styles['change']}>
            <DeltaChip
              value={change}
              display={popularityChangeText(change)}
              goodWhen="up"
              variant="plain"
            />
            <WhyButton
              label={`${row.name}'s popularity change`}
              value={popularityText(change)}
              source={{ trace: row.popularity.delta.trace }}
            />
          </span>
        );
      },
      numeric: true,
      card: 'stat',
    },
    {
      id: 'momentum',
      header: 'Momentum',
      cell: (row) => {
        if (!hasMomentum(row.momentum)) return noContractText(promotionName);
        const { change, after, trace } = row.momentum;
        return (
          <span className={styles['change']}>
            <span>{momentumText(after)}</span>
            <DeltaChip
              value={change}
              display={momentumChangeText(change)}
              goodWhen="up"
              variant="plain"
            />
            <WhyButton
              label={`${row.name}'s momentum`}
              value={momentumText(after)}
              source={{ trace }}
            />
          </span>
        );
      },
      numeric: true,
      card: 'stat',
    },
  ];
}

export interface AngleAftermathPanelProps {
  readonly lab: Pick<AngleLabState, 'shown' | 'outOfDate'>;
}

/** The Aftermath panel under the angle's result. */
export function AngleAftermathPanel({ lab }: AngleAftermathPanelProps) {
  const options = useEngineQuery('match.labOptions', {});
  const promotionName = options.data?.promotion?.name ?? FALLBACK_PROMOTION_NAME;
  const aftermath = lab.shown?.result.aftermath;
  let body;
  if (aftermath === undefined) {
    body = (
      <EmptyState
        icon="lab"
        headingLevel={3}
        title="Nothing run yet"
        body={ANGLE_AFTERMATH_EMPTY_BODY}
      />
    );
  } else if (aftermath.workers.length === 0) {
    body = (
      <EmptyState
        icon="lab"
        headingLevel={3}
        title="Nobody to show"
        body="This angle changes nobody's popularity or momentum."
      />
    );
  } else {
    body = (
      <>
        {lab.outOfDate && (
          <p className={styles['stale']} role="status">
            {ANGLE_AFTERMATH_STALE_TEXT}
          </p>
        )}
        <DataTable
          rows={aftermath.workers}
          columns={columns(aftermath.showRegionName, promotionName)}
          getRowId={(row) => row.personId}
          caption="What the angle would do to everyone in it"
          sortable={false}
          density="compact"
        />
        <p className={styles['note']}>{ANGLE_AFTERMATH_NOTE}</p>
      </>
    );
  }
  return <Panel title={ANGLE_AFTERMATH_TITLE}>{body}</Panel>;
}
