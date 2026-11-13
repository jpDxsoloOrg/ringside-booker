import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameDate, LabOptions, MatchCatalog, RegionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { useIsMobile } from '@/styles/useMediaQuery';
import { LabBatchResult } from './LabBatchResult';
import { labPanelsFor, useLabPanels } from './labPanelRegistry';
import type { LabPanelContext, LabPanelPlacement } from './labPanelRegistry';
import { LabResult } from './LabResult';
import { LabRunBar } from './LabRunBar';
import { LabSetupPanel, startingSides } from './LabSetupPanel';
import { isOutOfDate, useLabStore } from './labStore';
import { runsText } from './labText';
import { LabWarnings } from './LabWarnings';
import styles from './MatchLab.module.css';
import { LabResultGroup, RESULT_GROUP_TITLE } from './result/LabResultGroup';
import { MatchResultBlock } from './result/MatchResultBlock';
import { SidesBuilder } from './SidesBuilder';
import { useLabRunner } from './useLabRunner';
import { WorkerLinesTable } from './WorkerLinesTable';
import { WorkerPickerSheet } from './WorkerPickerSheet';
// The Aftermath panel (MTCH3-04), registered with the lab's chunk.
import './aftermath/register';

/** The empty state when no game answers: the enter-shell helper, or a world that went away. */
export const NO_GAME_TITLE = 'Load or start a game to use the Match lab';

/** The empty state for a save from before the match type catalogs. */
export const NO_CATALOG_BODY =
  'This save was started before match types existed. Start a new game to use the Match lab.';

interface ExtraPanelsProps {
  readonly placement: LabPanelPlacement;
  readonly context: LabPanelContext;
}

/** The panels other features registered for one place in the lab. */
function ExtraPanels({ placement, context }: ExtraPanelsProps) {
  const panels = labPanelsFor(useLabPanels(), placement, context);
  return (
    <>
      {panels.map((panel) => (
        <Panel key={panel.id} title={panel.title} className={styles['extraPanel']}>
          {panel.render(context)}
        </Panel>
      ))}
    </>
  );
}

interface LabProps {
  readonly options: LabOptions;
  readonly catalog: MatchCatalog;
  readonly regionId: RegionId;
  readonly today: GameDate | null;
}

/** The lab itself, once its options, catalog and defaults are in. */
function Lab({ options, catalog, regionId, today }: LabProps) {
  const setup = useLabStore((state) => state.setup);
  const sides = useLabStore((state) => state.sides);
  const lastRun = useLabStore((state) => state.lastRun);
  const plan = useLabStore((state) => state.result);
  const runner = useLabRunner(today);
  const isMobile = useIsMobile();
  const [pickerSide, setPickerSide] = useState<number | null>(null);

  const outOfDate = isOutOfDate({ setup, sides, result: plan }, lastRun);
  const result = lastRun?.rating ?? null;
  const context: LabPanelContext = {
    setup,
    sides,
    result,
    simulation: lastRun?.simulation ?? null,
    batch: lastRun?.batch ?? null,
  };

  let resultBody: ReactNode;
  if (lastRun === null) {
    resultBody = (
      <EmptyState
        icon="lab"
        title="Nothing run yet"
        body="Put someone on every side and press Run. A match plays out who wins and how; raise Runs to see how often."
      />
    );
  } else {
    const night =
      lastRun.simulation === null ? (
        <LabResult
          result={lastRun.rating}
          ratedOn={lastRun.date}
          today={today}
          outOfDate={outOfDate}
        />
      ) : (
        <MatchResultBlock
          simulation={lastRun.simulation}
          ratedOn={lastRun.date}
          today={today}
          outOfDate={outOfDate}
        />
      );
    resultBody =
      lastRun.batch === null ? (
        night
      ) : (
        <>
          <p className={styles['lastRunNote']}>
            Last of {runsText(lastRun.runs)}, in full. The counts for all of them are below.
          </p>
          {night}
        </>
      );
  }

  return (
    <div className={styles['labFrame']}>
      <div className={styles['lab']}>
        <div className={styles['setupColumn']}>
          <LabSetupPanel
            options={options}
            catalog={catalog}
            rulesLabel={result?.policy.label ?? null}
          />
          <ExtraPanels placement="setup" context={context} />
        </div>
        <div className={styles['sidesColumn']}>
          <SidesBuilder
            catalog={catalog}
            regionId={regionId}
            onAddWorker={(side) => {
              setPickerSide(side);
            }}
          />
          {isMobile && setup.kind === 'match' && (
            <Panel title={RESULT_GROUP_TITLE} className={styles['setupPanel']}>
              <LabResultGroup bare />
            </Panel>
          )}
        </div>
        <LabRunBar runner={runner} />
        <div className={styles['resultColumn']}>
          <Panel title="Result" variant="broadcast" className={styles['resultPanel']}>
            {resultBody}
            {result !== null && <LabWarnings warnings={result.warnings} />}
            {lastRun?.batch != null && <LabBatchResult batch={lastRun.batch} />}
          </Panel>
          {result !== null && result.workers.length > 0 && (
            <Panel title="Each worker" padding="none" className={styles['linesPanel']}>
              <WorkerLinesTable kind={result.kind} lines={result.workers} />
            </Panel>
          )}
          <ExtraPanels placement="result" context={context} />
        </div>
        <WorkerPickerSheet
          side={pickerSide}
          regionId={setup.regionId ?? regionId}
          // "Your roster" stays yours when the segment is rated as a rival (AIP1-07).
          promotionId={options.promotion?.id ?? setup.promotionId}
          onClose={() => {
            setPickerSide(null);
          }}
        />
      </div>
    </div>
  );
}

/** Seeds the lab from its defaults the first time it opens on this world. */
function SeededLab({ options, catalog, regionId, today }: LabProps) {
  const seeded = useLabStore((state) => state.seeded);
  const seed = useLabStore((state) => state.seed);
  useEffect(() => {
    if (!seeded) {
      seed(options, startingSides(catalog, options.defaults.kind, options.defaults.typeKey));
    }
  }, [catalog, options, seed, seeded]);
  if (!seeded) {
    return (
      <p className={styles['notice']} role="status">
        Setting up the lab…
      </p>
    );
  }
  return <Lab options={options} catalog={catalog} regionId={regionId} today={today} />;
}

/**
 * The Match lab under the screen's heading: set up a segment that isn't on any card, put people on
 * its sides and rate it. It reads its options (`match.labOptions`), the match and angle types
 * (`match.catalog`) and today's date, then hands over to the lab.
 */
export function MatchLabView() {
  const labOptions = useEngineQuery('match.labOptions', {});
  const catalog = useEngineQuery('match.catalog', {});
  const clock = useEngineQuery('clock.get', {});

  if (labOptions.status === 'loading' || catalog.status === 'loading') {
    return (
      <p className={styles['notice']} role="status">
        Loading the Match lab…
      </p>
    );
  }
  const options = labOptions.data;
  const types = catalog.data;
  if (options === undefined || types === undefined) {
    return (
      <EmptyState
        size="page"
        icon="lab"
        title={NO_GAME_TITLE}
        body="The Match lab rates segments with the people of a running game."
        headingLevel={2}
      />
    );
  }
  if (!options.available || !types.available) {
    return (
      <EmptyState
        size="page"
        icon="lab"
        title="No match types in this save"
        body={NO_CATALOG_BODY}
        headingLevel={2}
      />
    );
  }
  if (options.promotion === null) {
    return (
      <EmptyState
        size="page"
        icon="lab"
        title="You run no promotion"
        body="The Match lab rates segments for the promotion you run. Take a job to use it."
        headingLevel={2}
      />
    );
  }
  const regionId = options.defaults.regionId;
  if (regionId === null) {
    return (
      <EmptyState
        size="page"
        icon="lab"
        title="No regions in this world"
        body="A show needs a region to be rated in."
        headingLevel={2}
      />
    );
  }
  return (
    <SeededLab
      options={options}
      catalog={types}
      regionId={regionId}
      today={clock.data?.date ?? null}
    />
  );
}
