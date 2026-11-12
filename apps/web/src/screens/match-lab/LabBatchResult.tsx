import { useId } from 'react';
import type { SimulateBatchResult, Stats } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { formatNumber } from '@/components/format';
import { Histogram } from '@/components/Histogram';
import { VisuallyHidden } from '@/components/layout';
import { StatBar } from '@/components/StatBar';
import type { Tone } from '@/components/tone';
import { isSimulateBatch } from './labStore';
import type { LabBatch } from './labStore';
import { runsText, shareText, sideLabel, starsText, statsSummary } from './labText';
import styles from './MatchLab.module.css';
import { FINISH_CATEGORY_LABELS, FINISH_CATEGORY_TONES, namesText } from './result/resultText';

interface StatLineProps {
  readonly label: string;
  readonly stats: Stats;
}

function StatLine({ label, stats }: StatLineProps) {
  return (
    <div className={styles['statLine']}>
      <dt>{label}</dt>
      <dd>{statsSummary(stats)}</dd>
    </div>
  );
}

interface OutcomeRowProps {
  readonly label: string;
  readonly count: number;
  readonly runs: number;
  readonly unit: readonly [one: string, many: string];
  readonly tone: Tone;
}

/** One line of "Who won": the side (or Draws), the count and share, and a bar. */
function OutcomeRow({ label, count, runs, unit, tone }: OutcomeRowProps) {
  const countText = `${formatNumber(count)} ${count === 1 ? unit[0] : unit[1]}`;
  return (
    <li className={styles['outcomeRow']}>
      <span className={styles['outcomeLabel']}>{label}</span>
      <span className={styles['outcomeCount']}>
        {countText} · {shareText(count, runs)}
      </span>
      <StatBar
        className={styles['outcomeBar']}
        label={`${label}: ${countText} of ${runsText(runs)}`}
        value={count}
        max={runs}
        hideLabel
        showValue={false}
        tone={tone}
      />
    </li>
  );
}

interface OutcomeCountsProps {
  readonly batch: SimulateBatchResult;
}

/** How often each side won, drew or had no contest, then how often each finish came up. */
function OutcomeCounts({ batch }: OutcomeCountsProps) {
  const winnersId = useId();
  const finishesId = useId();
  return (
    <>
      <div className={styles['batchGroup']}>
        <h4 id={winnersId} className={styles['batchSubheading']}>
          Who won
        </h4>
        <ul className={styles['outcomeList']} aria-labelledby={winnersId}>
          {batch.sides.map((side) => (
            <OutcomeRow
              key={side.side}
              label={
                side.names.length === 0
                  ? sideLabel(side.side)
                  : `${sideLabel(side.side)}: ${namesText(side.names)}`
              }
              count={side.wins}
              runs={batch.runs}
              unit={['win', 'wins']}
              tone="data"
            />
          ))}
          <OutcomeRow
            label="Draws"
            count={batch.draws}
            runs={batch.runs}
            unit={['run', 'runs']}
            tone="neutral"
          />
          {batch.noContests > 0 && (
            <OutcomeRow
              label="No contests"
              count={batch.noContests}
              runs={batch.runs}
              unit={['run', 'runs']}
              tone="negative"
            />
          )}
        </ul>
      </div>
      <div className={styles['batchGroup']}>
        <h4 id={finishesId} className={styles['batchSubheading']}>
          Finishes, most common first
        </h4>
        <ol className={styles['finishCountList']} aria-labelledby={finishesId}>
          {batch.finishes.map((finish) => (
            <li key={finish.key} className={styles['finishCount']}>
              <span className={styles['finishCountName']}>{finish.name}</span>
              <Badge tone={FINISH_CATEGORY_TONES[finish.category]}>
                {FINISH_CATEGORY_LABELS[finish.category]}
              </Badge>
              <span className={styles['finishCountRuns']}>
                {formatNumber(finish.count)}
                <VisuallyHidden> {finish.count === 1 ? 'run' : 'runs'}</VisuallyHidden>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

export interface LabBatchResultProps {
  readonly batch: LabBatch;
}

/**
 * Runs above 1 (MTCH2-07): for a match, how often each side won or drew and the finishes, most
 * common first; then, for any segment, how the score spread as a histogram with the mean and one
 * spread either side, the summary in words, how often each star rating came up, and the same
 * summary for the performance and the crowd.
 */
export function LabBatchResult({ batch }: LabBatchResultProps) {
  const runs = runsText(batch.runs);
  const headingId = useId();
  const starCounts = batch.stars.byQuarter.filter((quarter) => quarter.count > 0);
  return (
    <section className={styles['batch']} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles['batchHeading']}>
        Over {runs}
      </h3>
      {isSimulateBatch(batch) && <OutcomeCounts batch={batch} />}
      <div className={styles['batchGroup']}>
        <h4 className={styles['batchSubheading']}>Score</h4>
        <Histogram
          bins={batch.histogram}
          mean={batch.score.mean}
          sd={batch.score.sd}
          label={`Score over ${runs}`}
          unit="points"
        />
        <p className={styles['batchSummary']}>{statsSummary(batch.score)}</p>
      </div>
      <div className={styles['batchGroup']}>
        <h4 className={styles['batchSubheading']}>Stars</h4>
        <ul className={styles['starCountList']}>
          {starCounts.map((quarter) => (
            <li key={quarter.stars} className={styles['starCount']}>
              <span className={styles['starCountValue']}>
                {formatNumber(quarter.stars, { maximumFractionDigits: 2 })}★
              </span>
              <span className={styles['starCountRuns']}>
                {quarter.count}
                <VisuallyHidden>
                  {' '}
                  {quarter.count === 1 ? 'run' : 'runs'} at {starsText(quarter.stars)}
                </VisuallyHidden>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <dl className={styles['statLines']}>
        <StatLine label="Stars" stats={batch.stars} />
        {batch.workRate !== null && <StatLine label="Work rate" stats={batch.workRate} />}
        {batch.talk !== null && <StatLine label="Talk" stats={batch.talk} />}
        <StatLine label="Crowd" stats={batch.crowd} />
      </dl>
      <p className={styles['batchNote']}>
        The crowd expected {formatNumber(batch.expectation, { maximumFractionDigits: 1 })} every
        night: expectation has no roll.
      </p>
    </section>
  );
}
