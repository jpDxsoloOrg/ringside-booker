/**
 * The Aftermath panel's body, drawn from one `SegmentAftermath` with no engine (MTCH3-04): one
 * panel per side with its result, and for every worker their popularity in the show's region,
 * the regions the change spreads to (or the country and continent roll-ups) and their momentum.
 * Every after-value and change has a Why?; before-values are plain inputs. No morale anywhere: a
 * match result never changes it (D-09).
 */
import { useId, useState } from 'react';
import { hasMomentum } from '@ringside/engine';
import type {
  AftermathMomentum,
  AftermathRegionRow,
  AftermathWorker,
  SegmentAftermath,
  TraceNode,
} from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { DeltaChip } from '@/components/DeltaChip';
import { VisuallyHidden } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { RadioGroup } from '@/components/RadioGroup';
import { WhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { sideLabel } from '../labText';
import styles from './AftermathPanel.module.css';
import {
  AFTERMATH_COMPACT_FROM,
  AFTERMATH_LEVEL_LABELS,
  AFTERMATH_LEVELS,
  AFTERMATH_STALE_TEXT,
  momentumChangeText,
  momentumText,
  noContractText,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  popularityChangeText,
  popularityText,
  regionSourceText,
  regionWhyLabel,
  regionWhyTrace,
} from './aftermathText';
import type { AftermathLevel } from './aftermathText';

/** One row of a worker's popularity table: a region, a country or a continent. */
interface PlaceRow {
  readonly id: string;
  readonly name: string;
  /** Null for a country or continent. */
  readonly source: string | null;
  readonly before: number;
  readonly after: number;
  readonly change: number;
  readonly why: TraceNode;
}

function regionPlaceRow(row: AftermathRegionRow): PlaceRow {
  return {
    id: row.regionId,
    name: row.name,
    source: regionSourceText(row),
    before: row.before,
    after: row.after,
    change: row.change,
    why: regionWhyTrace(row),
  };
}

/** "→", read out as "to". */
function Arrow() {
  return (
    <>
      <span aria-hidden="true">→</span>
      <VisuallyHidden>to</VisuallyHidden>
    </>
  );
}

/** A change chip with its Why? beside it. */
function ExplainedChange({
  label,
  value,
  change,
  changeText,
  trace,
}: {
  readonly label: string;
  /** The after-value the Why? explains. */
  readonly value: string;
  readonly change: number;
  readonly changeText: string;
  readonly trace: TraceNode;
}) {
  return (
    <span className={styles['change']}>
      <DeltaChip value={change} display={changeText} goodWhen="up" variant="plain" />
      <WhyButton label={label} value={value} source={{ trace }} />
    </span>
  );
}

function placeColumns(withSource: boolean, levelHeader: string): ColumnDef<PlaceRow>[] {
  const columns: ColumnDef<PlaceRow>[] = [
    { id: 'name', header: levelHeader, cell: (row) => row.name, card: 'title' },
  ];
  if (withSource) {
    columns.push({ id: 'source', header: 'Source', cell: (row) => row.source, card: 'subtitle' });
  }
  columns.push(
    {
      id: 'before',
      header: 'Before',
      cell: (row) => popularityText(row.before),
      numeric: true,
      card: 'meta',
    },
    {
      id: 'after',
      header: 'After',
      cell: (row) => popularityText(row.after),
      numeric: true,
      card: 'meta',
    },
    {
      id: 'change',
      header: 'Change',
      cell: (row) => (
        <DeltaChip
          value={row.change}
          display={popularityChangeText(row.change)}
          goodWhen="up"
          variant="plain"
        />
      ),
      numeric: true,
      card: 'stat',
    },
    {
      id: 'why',
      header: 'Why?',
      cell: (row) => (
        <WhyButton
          label={regionWhyLabel(row.name)}
          value={popularityText(row.after)}
          source={{ trace: row.why }}
        />
      ),
      align: 'center',
      width: 'xs',
      card: 'meta',
      hideable: false,
    },
  );
  return columns;
}

const REGION_COLUMNS = placeColumns(true, 'Region');
const COUNTRY_COLUMNS = placeColumns(false, 'Country');
const CONTINENT_COLUMNS = placeColumns(false, 'Continent');

interface PlacesTableProps {
  readonly worker: AftermathWorker;
  readonly level: AftermathLevel;
}

/** The worker's regions (show region, neighbours behind a toggle, then reach) or roll-ups. */
function PlacesTable({ worker, level }: PlacesTableProps) {
  const [neighboursOpen, setNeighboursOpen] = useState(false);
  const neighboursId = useId();
  const { regions, countries, continents } = worker.popularity;

  if (level !== 'region') {
    const rollups = level === 'country' ? countries : continents;
    const rows = rollups.map((row): PlaceRow => ({
      id: row.id,
      name: row.name,
      source: null,
      before: row.before,
      after: row.after,
      change: row.change,
      why: row.trace,
    }));
    return (
      <DataTable
        rows={rows}
        columns={level === 'country' ? COUNTRY_COLUMNS : CONTINENT_COLUMNS}
        getRowId={(row) => row.id}
        caption={`${worker.name}: popularity by ${AFTERMATH_LEVEL_LABELS[level].toLowerCase()}`}
        sortable={false}
        density="compact"
      />
    );
  }

  const show = regions.filter((row) => row.source === 'show');
  const neighbours = regions.filter((row) => row.source === 'neighbour');
  const reach = regions.filter((row) => row.source !== 'show' && row.source !== 'neighbour');
  const rows = [...show, ...(neighboursOpen ? neighbours : []), ...reach].map(regionPlaceRow);
  return (
    <div className={styles['places']}>
      {neighbours.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          iconStart={neighboursOpen ? 'down' : 'more'}
          aria-expanded={neighboursOpen}
          aria-controls={neighboursId}
          onClick={() => {
            setNeighboursOpen((open) => !open);
          }}
        >
          Neighbouring regions ({neighbours.length})
        </Button>
      )}
      <div id={neighboursId}>
        <DataTable
          rows={rows}
          columns={REGION_COLUMNS}
          getRowId={(row) => row.id}
          caption={`${worker.name}: popularity by region`}
          sortable={false}
          density="compact"
        />
      </div>
    </div>
  );
}

function MomentumLine({
  momentum,
  name,
}: {
  readonly momentum: AftermathMomentum;
  readonly name: string;
}) {
  return (
    <p className={styles['line']}>
      <span className={styles['lineLabel']}>Momentum</span>
      <span className={styles['figures']}>
        <span className="tabular">{momentumText(momentum.before)}</span>
        <Arrow />
        <span className="tabular">{momentumText(momentum.after)}</span>
      </span>
      <ExplainedChange
        label={`${name}'s momentum`}
        value={momentumText(momentum.after)}
        change={momentum.change}
        changeText={momentumChangeText(momentum.change)}
        trace={momentum.trace}
      />
      {momentum.started && <span className={styles['note']}>First match under this contract</span>}
    </p>
  );
}

interface WorkerBlockProps {
  readonly worker: AftermathWorker;
  readonly level: AftermathLevel;
  readonly promotionName: string;
  /** With many competitors, the regions open one worker at a time. */
  readonly compact: boolean;
}

function WorkerBlock({ worker, level, promotionName, compact }: WorkerBlockProps) {
  const [placesOpen, setPlacesOpen] = useState(false);
  const placesId = useId();
  const showRow = worker.popularity.regions.find((row) => row.source === 'show');
  return (
    <article className={styles['worker']} aria-label={worker.name}>
      <h4 className={styles['workerName']}>
        <WorkerLink personId={worker.personId} name={worker.name} />
      </h4>
      <p className={styles['resultLine']}>{worker.resultLine}</p>
      {showRow !== undefined && (
        <p className={styles['line']}>
          <span className={styles['lineLabel']}>Popularity</span>
          <span className={styles['region']}>{showRow.name}</span>
          <span className={styles['figures']}>
            <span className="tabular">{popularityText(showRow.before)}</span>
            <Arrow />
            <span className="tabular">{popularityText(showRow.after)}</span>
          </span>
          <ExplainedChange
            label={`${worker.name}'s ${regionWhyLabel(showRow.name).toLowerCase()}`}
            value={popularityText(showRow.after)}
            change={showRow.change}
            changeText={popularityChangeText(showRow.change)}
            trace={regionWhyTrace(showRow)}
          />
        </p>
      )}
      {hasMomentum(worker.momentum) ? (
        <MomentumLine momentum={worker.momentum} name={worker.name} />
      ) : (
        <p className={styles['line']}>
          <span className={styles['lineLabel']}>Momentum</span>
          <span className={styles['note']}>{noContractText(promotionName)}</span>
        </p>
      )}
      {compact && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={placesOpen}
          aria-controls={placesId}
          onClick={() => {
            setPlacesOpen((open) => !open);
          }}
        >
          {placesOpen ? 'Hide every region' : 'Show every region'}
        </Button>
      )}
      <div id={placesId}>
        {(!compact || placesOpen) && <PlacesTable worker={worker} level={level} />}
      </div>
    </article>
  );
}

export interface AftermathViewProps {
  readonly aftermath: SegmentAftermath;
  /** The promotion the match is for, named in the no-contract note. */
  readonly promotionName: string;
  readonly level: AftermathLevel;
  readonly onLevelChange: (level: AftermathLevel) => void;
  /** True when the setup changed after the Run these numbers come from. */
  readonly stale?: boolean;
}

/** The sides in stored order, each with its workers and the side's result. */
function sidesOf(aftermath: SegmentAftermath): { side: number; workers: AftermathWorker[] }[] {
  const bySide = new Map<number, AftermathWorker[]>();
  for (const worker of aftermath.workers) {
    bySide.set(worker.side, [...(bySide.get(worker.side) ?? []), worker]);
  }
  return [...bySide.entries()]
    .sort(([left], [right]) => left - right)
    .map(([side, workers]) => ({ side, workers }));
}

/** What the result would do to everyone in the match. */
export function AftermathView({
  aftermath,
  promotionName,
  level,
  onLevelChange,
  stale = false,
}: AftermathViewProps) {
  const compact = aftermath.workers.length >= AFTERMATH_COMPACT_FROM;
  return (
    <div className={styles['aftermath']}>
      {stale && (
        <p className={styles['stale']} role="status">
          {AFTERMATH_STALE_TEXT}
        </p>
      )}
      <p className={styles['lead']}>
        Popularity moves most in {aftermath.showRegionName}, where the show is, and spreads to the
        regions next to it. Momentum is with {promotionName}.
      </p>
      <RadioGroup
        legend="Show popularity by"
        layout="row"
        options={AFTERMATH_LEVELS.map((value) => ({ value, label: AFTERMATH_LEVEL_LABELS[value] }))}
        value={level}
        onValueChange={onLevelChange}
        className={styles['levels'] ?? ''}
      />
      <div className={styles['sides']}>
        {sidesOf(aftermath).map(({ side, workers }) => {
          const outcome = workers[0]?.outcome ?? 'noContest';
          return (
            <Panel
              key={side}
              title={sideLabel(side)}
              headingLevel={3}
              actions={<Badge tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>}
              className={styles['side']}
            >
              <div className={styles['workers']}>
                {workers.map((worker) => (
                  <WorkerBlock
                    key={worker.personId}
                    worker={worker}
                    level={level}
                    promotionName={promotionName}
                    compact={compact}
                  />
                ))}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
