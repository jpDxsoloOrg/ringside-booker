import { useId } from 'react';
import type { PreviewBatchResult, Stats } from '@ringside/engine';
import { formatNumber } from '@/components/format';
import { Histogram } from '@/components/Histogram';
import { VisuallyHidden } from '@/components/layout';
import { starsText, statsSummary } from './labText';
import styles from './MatchLab.module.css';

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

export interface LabBatchResultProps {
  readonly batch: PreviewBatchResult;
}

/**
 * Run x100: how the score spreads over a hundred nights, as a histogram with the mean and one
 * spread either side, the summary in words, how often each star rating came up, and the same
 * summary for the performance and the crowd.
 */
export function LabBatchResult({ batch }: LabBatchResultProps) {
  const runsText = `${formatNumber(batch.runs)} runs`;
  const headingId = useId();
  const starCounts = batch.stars.byQuarter.filter((quarter) => quarter.count > 0);
  return (
    <section className={styles['batch']} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles['batchHeading']}>
        Score over {runsText}
      </h3>
      <Histogram
        bins={batch.histogram}
        mean={batch.score.mean}
        sd={batch.score.sd}
        label={`Score over ${runsText}`}
        unit="points"
      />
      <p className={styles['batchSummary']}>{statsSummary(batch.score)}</p>
      <div className={styles['starCounts']}>
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
