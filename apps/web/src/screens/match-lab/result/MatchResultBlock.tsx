import type { GameDate, SimulateResult } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Explained } from '@/components/Trace';
import { LabResult } from '../LabResult';
import styles from './Result.module.css';
import {
  FINISH_CATEGORY_LABELS,
  FINISH_CATEGORY_TONES,
  methodLineText,
  noTitleChangeText,
  outcomeHeadline,
} from './resultText';

export interface MatchResultBlockProps {
  readonly simulation: SimulateResult;
  /** The game date it was simulated on. */
  readonly ratedOn: GameDate | null;
  readonly today: GameDate | null;
  /** The setup, sides or result plan changed since the Run. */
  readonly outOfDate: boolean;
  /**
   * True when titles are on the line, so a finish that can't move them says so. Nothing sets it
   * until MTCH8's Stakes add titles to the lab; the Finish select's "(no title change)" covers it.
   */
  readonly titlesOnLine?: boolean;
}

/**
 * A simulated match (MTCH2-04): who won with a Why? that lists each side's auto-winner score and the
 * rule that picked it, how (method and finish, with the finish's category), then MTCH1's score bug,
 * crowd line and slot, rated with the finish's effects. No minutes anywhere (D-10).
 *
 * Show night's results use EVT3's `SegmentResultCard`, whose result line opens the same "Match
 * result" decision (EVT3-07). This block stays the lab's own: it adds the finish's category and
 * summary and the Run's freshness, which a results page does not need.
 */
export function MatchResultBlock({
  simulation,
  ratedOn,
  today,
  outOfDate,
  titlesOnLine = false,
}: MatchResultBlockProps) {
  const headline = outcomeHeadline(simulation);
  const { finish } = simulation;
  return (
    <div className={styles['block']}>
      <div className={styles['headlineRow']}>
        <p className={styles['headline']} data-outcome={simulation.outcome.kind}>
          <Explained value={headline} label="Winner" trace={simulation.resultTrace} />
        </p>
        {simulation.randomWinnersMode && (
          <Badge tone="prestige" variant="solid">
            Random winners
          </Badge>
        )}
      </div>
      <p className={styles['methodLine']}>
        <span>{methodLineText(simulation)}</span>
        <Badge tone={FINISH_CATEGORY_TONES[finish.category]}>
          {FINISH_CATEGORY_LABELS[finish.category]}
        </Badge>
      </p>
      {finish.summary !== '' && <p className={styles['finishSummary']}>{finish.summary}</p>}
      {titlesOnLine && !finish.allowsTitleChange && (
        <p className={styles['titleNote']}>{noTitleChangeText(finish.name)}</p>
      )}
      <LabResult
        result={simulation.preview}
        ratedOn={ratedOn}
        today={today}
        outOfDate={outOfDate}
      />
    </div>
  );
}
