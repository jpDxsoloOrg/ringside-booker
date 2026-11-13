/**
 * The Match lab's Physical panel (MTCH4-05): what the match on screen does to each competitor's
 * body, from `extensions.physical` of the last `match.simulate`, and how often it hurts someone over
 * a batch, from `extensionSummaries.physical`. The lab's own Run asks for both, so the panel makes
 * no engine round-trip per run of its own.
 *
 * Two controls feed the next Run: a "Fatigue going in" what-if per worker (which plays the same
 * nights again with the new fatigue at once) and an optional Producer, stored as
 * `labStore.crew.producerId` (the field MTCH8's Crew section will own). Nothing is written to the
 * world: every number is a preview.
 */
import { useCallback, useId, useMemo } from 'react';
import type { PersonId, RegionId, PromotionId, SimulateResult } from '@ringside/engine';
import { DURATION_CLASS_LABELS } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { PhysicalTollSummary, PhysicalTollTable } from '@/components/PhysicalTollTable';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { OUT_OF_DATE_TEXT } from '../LabResult';
import type { LabPanelContext } from '../labPanelRegistry';
import { isOutOfDate, LAB_MAX_RUNS, useLabStore } from '../labStore';
import { useLabRunner } from '../useLabRunner';
import styles from './PhysicalPanel.module.css';

/** The Producer Select's "nobody" option. */
export const NO_PRODUCER_VALUE = 'none';
export const NO_PRODUCER_LABEL = 'No producer';

/** The empty state's body before the first Run. */
export const PHYSICAL_EMPTY_BODY =
  "Run the match to see what it costs each worker's body: fatigue, wear, learning and the chance of an injury.";

/** "Run x100": the batch button in the empty Run x100 block. */
export const RUN_MANY_LABEL = `Run x${String(LAB_MAX_RUNS)}`;

/** The note under the table: a preview never changes anyone. */
export const PREVIEW_NOTE =
  'A preview: nobody gets tired, hurt or better from it. The what-if changes only this lab.';

interface ProducerSelectProps {
  readonly regionId: RegionId;
  readonly promotionId: PromotionId | null;
}

/** The lab's producer, from the roster's people with the producer role. */
function ProducerSelect({ regionId, promotionId }: ProducerSelectProps) {
  const producerId = useLabStore((state) => state.crew.producerId);
  const setProducer = useLabStore((state) => state.setProducer);
  const roster = useEngineQuery('match.labWorkers', {
    scope: 'mine',
    regionId,
    ...(promotionId === null ? {} : { promotionId }),
  });
  const options = useMemo<readonly SelectOption[]>(() => {
    const producers = (roster.data?.rows ?? [])
      .filter((row) => row.roles.includes('producer'))
      .map((row) => ({ value: row.personId, label: row.name }))
      .sort((left, right) => (left.label < right.label ? -1 : left.label > right.label ? 1 : 0));
    return [{ value: NO_PRODUCER_VALUE, label: NO_PRODUCER_LABEL }, ...producers];
  }, [roster.data]);
  return (
    <div className={styles['producer']}>
      <Select
        label="Producer"
        options={options}
        value={producerId ?? NO_PRODUCER_VALUE}
        onValueChange={(value) => {
          setProducer(roster.data?.rows.find((row) => row.personId === value)?.personId ?? null);
        }}
        className={styles['producerSelect'] ?? ''}
      />
      <p className={styles['hint']}>A producer helps everyone in the match learn a little more.</p>
    </div>
  );
}

export interface PhysicalPanelProps {
  readonly simulation: LabPanelContext['simulation'];
  readonly batch: LabPanelContext['batch'];
}

function physicalOf(simulation: SimulateResult | null) {
  return simulation?.extensions?.physical ?? null;
}

/** The panel's body. */
export function PhysicalPanel({ simulation, batch }: PhysicalPanelProps) {
  const setup = useLabStore((state) => state.setup);
  const pending = useLabStore((state) => state.pending);
  const setFatigueOverride = useLabStore((state) => state.setFatigueOverride);
  const setRuns = useLabStore((state) => state.setRuns);
  const stale = useLabStore((state) =>
    isOutOfDate(
      { setup: state.setup, sides: state.sides, result: state.result, crew: state.crew },
      state.lastRun,
    ),
  );
  // Already asked for by the lab itself, so this is answered from the cache.
  const clock = useEngineQuery('clock.get', {});
  const runner = useLabRunner(clock.data?.date ?? null);

  const onFatigueChange = useCallback(
    (personId: PersonId, fatigue: number | null) => {
      setFatigueOverride(personId, fatigue);
      // The same nights again, so only the what-if changes the numbers.
      void runner.run({ simulate: true, sameSeed: true });
    },
    [runner, setFatigueOverride],
  );

  const manyHeadingId = useId();
  const physical = physicalOf(simulation);
  const summary = batch?.extensionSummaries?.physical ?? null;

  return (
    <div className={styles['panel']}>
      {setup.regionId !== null && (
        <ProducerSelect regionId={setup.regionId} promotionId={setup.promotionId} />
      )}
      {physical === null ? (
        <EmptyState
          icon="lab"
          headingLevel={3}
          title="Nothing run yet"
          body={PHYSICAL_EMPTY_BODY}
        />
      ) : (
        <>
          <p className={styles['context']}>
            <Badge tone="data">{DURATION_CLASS_LABELS[physical.durationClass]} match</Badge>
            <span>
              Longer matches tire and wear workers more. At most{' '}
              {physical.maxInjuriesPerSegment === 1
                ? 'one worker'
                : `${String(physical.maxInjuriesPerSegment)} workers`}{' '}
              can be hurt in one match.
            </span>
          </p>
          {stale && (
            <p className={styles['stale']} role="status">
              <Badge tone="prestige" variant="solid">
                {OUT_OF_DATE_TEXT}
              </Badge>
              <span>The setup changed since this run.</span>
            </p>
          )}
          <PhysicalTollTable
            workers={physical.workers}
            onFatigueChange={onFatigueChange}
            disabled={pending}
          />
          <p className={styles['hint']}>{PREVIEW_NOTE}</p>
        </>
      )}
      <section className={styles['many']} aria-labelledby={manyHeadingId}>
        <h3 id={manyHeadingId} className={styles['heading']}>
          Over many runs
        </h3>
        <PhysicalTollSummary
          summary={summary}
          emptyAction={
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setRuns(LAB_MAX_RUNS);
                void runner.run({ simulate: true });
              }}
            >
              {RUN_MANY_LABEL}
            </Button>
          }
        />
      </section>
    </div>
  );
}
