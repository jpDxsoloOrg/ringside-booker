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
import { isOutOfDate, isSimulationOutOfDate, useLabStore } from './labStore';
import { LabWarnings } from './LabWarnings';
import styles from './MatchLab.module.css';
import { LabResultGroup } from './result/LabResultGroup';
import { MatchResultBlock } from './result/MatchResultBlock';
import { SidesBuilder } from './SidesBuilder';
import { useLabRunner } from './useLabRunner';
import { WorkerLinesTable } from './WorkerLinesTable';
import { WorkerPickerSheet } from './WorkerPickerSheet';

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
  const previewSeed = useLabStore((state) => state.previewSeed);
  const submitted = useLabStore((state) => state.submitted);
  const lastRun = useLabStore((state) => state.lastRun);
  const lastBatch = useLabStore((state) => state.lastBatch);
  const plan = useLabStore((state) => state.result);
  const simulation = useLabStore((state) => state.simulation);
  const runner = useLabRunner(today);
  const isMobile = useIsMobile();
  const [pickerSide, setPickerSide] = useState<number | null>(null);

  const outOfDate = isOutOfDate({ setup, sides, previewSeed }, submitted);
  const result = lastRun?.result ?? null;
  const context: LabPanelContext = {
    setup,
    sides,
    result,
    batch: lastBatch?.result ?? null,
    simulation: simulation?.result ?? null,
  };

  let resultBody: ReactNode;
  if (lastRun === null) {
    resultBody = (
      <EmptyState
        icon="lab"
        title="Nothing rated yet"
        body="Put someone on every side and press Run to rate one night, or Simulate to play out who wins too. Run x100 shows the spread."
      />
    );
  } else if (simulation !== null) {
    resultBody = (
      <MatchResultBlock
        simulation={simulation.result}
        ratedOn={simulation.date}
        today={today}
        outOfDate={isSimulationOutOfDate(
          { setup, sides, previewSeed, result: plan },
          simulation.args,
        )}
      />
    );
  } else {
    resultBody = (
      <LabResult
        result={lastRun.result}
        ratedOn={lastRun.date}
        today={today}
        outOfDate={outOfDate}
      />
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
            <Panel title="Result plan" className={styles['setupPanel']}>
              <LabResultGroup />
            </Panel>
          )}
        </div>
        <LabRunBar runner={runner} />
        <div className={styles['resultColumn']}>
          <Panel title="Result" variant="broadcast" className={styles['resultPanel']}>
            {resultBody}
            {result !== null && <LabWarnings warnings={result.warnings} />}
            {lastBatch !== null && <LabBatchResult batch={lastBatch.result} />}
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
          promotionId={setup.promotionId}
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
