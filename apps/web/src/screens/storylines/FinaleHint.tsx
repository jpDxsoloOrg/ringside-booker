import type { GameDate, StorylineDetail } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatGameDate } from '@/components/format';
import { Panel } from '@/components/Panel';
import styles from './FinaleHint.module.css';

/** "Finale played on Jan 4, 2027: end the storyline to pay it off". */
export function finalePlayedText(date: GameDate): string {
  return `Finale played on ${formatGameDate(date)}: end the storyline to pay it off`;
}

/** The date the storyline's finale was played, or null when it has none or it hasn't run yet. */
export function finalePlayedOn(storyline: StorylineDetail): GameDate | null {
  if (storyline.status !== 'active') return null;
  const finale = storyline.timeline.find((entry) => entry.isFinale);
  return finale === undefined || finale.stars === null ? null : finale.date;
}

/**
 * Once an active storyline's finale has been played, a panel suggesting the player end it now,
 * with the End button. Nothing otherwise.
 */
export function FinaleHint({
  storyline,
  onEnd,
}: {
  readonly storyline: StorylineDetail;
  readonly onEnd: () => void;
}) {
  const playedOn = finalePlayedOn(storyline);
  if (playedOn === null || !storyline.editable) return null;
  return (
    <Panel title="Finale played">
      <div className={styles['body']}>
        <p className={styles['text']}>{finalePlayedText(playedOn)}</p>
        <Button variant="primary" onClick={onEnd}>
          End and pay off
        </Button>
      </div>
    </Panel>
  );
}
