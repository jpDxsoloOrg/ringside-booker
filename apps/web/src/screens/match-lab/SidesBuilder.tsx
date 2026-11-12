import { useMemo } from 'react';
import type { LabWorkerRow, MatchCatalog, PersonId, RegionId } from '@ringside/engine';
import { LAB_WORKERS_MAX_LIMIT } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { formatNumber } from '@/components/format';
import { Button, IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { LAB_MAX_SIDE_SIZE, LAB_MAX_SIDES, useLabStore } from './labStore';
import { angleLimitsText, matchLimitsText, sideLabel } from './labText';
import styles from './MatchLab.module.css';
import { renderWorkerName } from './workerName';

const NO_ROWS: readonly LabWorkerRow[] = [];

interface WorkerChipProps {
  readonly side: number;
  readonly personId: PersonId;
  readonly row: LabWorkerRow | undefined;
  readonly onRemove: () => void;
}

/** One person on a side: name, popularity in the show's region, and why they can't work if so. */
function WorkerChip({ side, personId, row, onRemove }: WorkerChipProps) {
  const name = row?.name ?? personId;
  return (
    <li className={styles['workerChip']}>
      <span className={styles['workerChipText']}>
        <span className={styles['workerChipName']}>{renderWorkerName(personId, name)}</span>
        <span className={styles['workerChipMeta']}>
          {row === undefined ? 'Popularity unknown' : `Popularity ${formatNumber(row.popularity)}`}
        </span>
        {row !== undefined && !row.available && (
          <Badge tone="negative" className={styles['unavailable']}>
            <Icon name="injured" size="sm" decorative />
            {row.unavailableReason ?? 'Unavailable'}
          </Badge>
        )}
      </span>
      <IconButton
        icon="close"
        size="sm"
        label={`Remove ${name} from ${sideLabel(side)}`}
        onClick={onRemove}
      />
    </li>
  );
}

export interface SidesBuilderProps {
  readonly catalog: MatchCatalog;
  /** The show's region: popularity on the chips is read there. */
  readonly regionId: RegionId;
  /** Opens the worker picker for a side (0-based). */
  readonly onAddWorker: (side: number) => void;
}

/**
 * The middle column: one card per side with the people on it. The lab lets a line-up break the
 * match type's limits on purpose, so the owner can see the warnings a Run gives back; the limits
 * are shown under the heading rather than enforced.
 */
export function SidesBuilder({ catalog, regionId, onAddWorker }: SidesBuilderProps) {
  const setup = useLabStore((state) => state.setup);
  const sides = useLabStore((state) => state.sides);
  const people = useLabStore((state) => state.people);
  const removePerson = useLabStore((state) => state.removePerson);
  const addSide = useLabStore((state) => state.addSide);
  const removeSide = useLabStore((state) => state.removeSide);
  const clearAll = useLabStore((state) => state.clearAll);

  // Popularity and availability move with the region and with every day, so the chips read them
  // fresh; what the picker knew stands in for anyone past the list's end.
  const fresh = useEngineQuery(
    'match.labWorkers',
    {
      scope: 'everyone',
      regionId,
      limit: LAB_WORKERS_MAX_LIMIT,
      ...(setup.promotionId === null ? {} : { promotionId: setup.promotionId }),
    },
    { enabled: sides.some((side) => side.length > 0) },
  );
  const freshRows = fresh.data?.rows ?? NO_ROWS;
  const rowsById = useMemo(() => new Map(freshRows.map((row) => [row.personId, row])), [freshRows]);

  const matchType =
    setup.kind === 'match'
      ? catalog.matchTypes.find((option) => option.key === setup.typeKey)
      : undefined;
  const angleType =
    setup.kind === 'angle'
      ? catalog.angleTypes.find((option) => option.key === setup.typeKey)
      : undefined;
  const limits =
    matchType !== undefined
      ? `${matchType.name}: ${matchLimitsText(matchType)}`
      : angleType !== undefined
        ? `${angleType.name}: ${angleLimitsText(angleType)}`
        : undefined;
  const placed = sides.reduce((total, side) => total + side.length, 0);

  return (
    <Panel
      title="Sides"
      {...(limits === undefined ? {} : { subtitle: limits })}
      className={styles['sidesPanel']}
      actions={
        <Button
          size="sm"
          variant="ghost"
          iconStart="trash"
          disabled={placed === 0}
          onClick={clearAll}
        >
          Clear all
        </Button>
      }
    >
      <ol className={styles['sides']}>
        {sides.map((members, side) => {
          const full = members.length >= LAB_MAX_SIDE_SIZE;
          return (
            // Sides are numbered by place; removing one renumbers the rest, as the labels say.
            <li key={`side-${String(side)}`} className={styles['side']}>
              <div className={styles['sideHead']}>
                <h3 className={styles['sideTitle']}>{sideLabel(side)}</h3>
                <span className={styles['sideCount']}>
                  {members.length === 0
                    ? 'Nobody yet'
                    : `${String(members.length)} ${members.length === 1 ? 'person' : 'people'}`}
                  {full && ' (full)'}
                </span>
                {sides.length > 1 && (
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={`Remove ${sideLabel(side)}`}
                    onClick={() => {
                      removeSide(side);
                    }}
                  />
                )}
              </div>
              {members.length > 0 && (
                <ul className={styles['workerChips']} aria-label={`${sideLabel(side)} line-up`}>
                  {members.map((personId) => (
                    <WorkerChip
                      key={personId}
                      side={side}
                      personId={personId}
                      row={rowsById.get(personId) ?? people[personId]}
                      onRemove={() => {
                        removePerson(side, personId);
                      }}
                    />
                  ))}
                </ul>
              )}
              <Button
                size="sm"
                iconStart="add"
                disabled={full}
                aria-label={`Add worker to ${sideLabel(side)}`}
                onClick={() => {
                  onAddWorker(side);
                }}
              >
                Add worker
              </Button>
            </li>
          );
        })}
      </ol>
      <div className={styles['sidesFooter']}>
        <Button
          size="sm"
          variant="ghost"
          iconStart="add"
          disabled={sides.length >= LAB_MAX_SIDES}
          onClick={addSide}
        >
          Add side
        </Button>
        <span className={styles['sideCount']}>
          {sides.length} of {LAB_MAX_SIDES} sides
        </span>
      </div>
    </Panel>
  );
}
