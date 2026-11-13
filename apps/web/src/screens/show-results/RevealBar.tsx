import { Button } from '@/components/Button';
import styles from './RevealBar.module.css';

export interface RevealBarProps {
  /** Reveals the next item. Enter and Space work on the button, as on any button. */
  readonly onNext: () => void;
  /** Reveals everything at once. */
  readonly onShowAll: () => void;
  /** The Next button's words: "Next segment", then "Show score" for the last step. */
  readonly nextLabel: string;
  /** The group's name for screen readers. */
  readonly label?: string;
}

/**
 * The tap-to-advance controls of a reveal (EVT3-10): Next and Show all, kept in reach at the bottom
 * of the screen while the reveal runs. Nothing advances on its own. Generic, so a live show night
 * (EVT10) can put it under its own screen with `useRevealSequence`.
 */
export function RevealBar({
  onNext,
  onShowAll,
  nextLabel,
  label = 'Results reveal',
}: RevealBarProps) {
  return (
    <div className={styles['bar']} role="group" aria-label={label}>
      <Button variant="primary" iconStart="chevron-right" onClick={onNext}>
        {nextLabel}
      </Button>
      <Button variant="secondary" iconStart="fast-forward" onClick={onShowAll}>
        Show all
      </Button>
    </div>
  );
}
