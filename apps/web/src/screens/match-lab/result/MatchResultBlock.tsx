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
 * EVT3's `SegmentResultCard` takes over on show night; until it exists this block is the only place
 * finishes are seen.
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
