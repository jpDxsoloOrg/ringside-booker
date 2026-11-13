import type { ReactNode } from 'react';
import type { BodyPart, TraceRef } from '@ringside/engine';
import { BODY_PART_LABELS } from '@ringside/engine';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import { Explained } from '../Trace';
import styles from './InjuryBanner.module.css';

/** The banner's kicker. The text, not only the colour, says what happened. */
export const INJURED_KICKER = 'Injured';

/** "Out about 1 week", "Out about 6 weeks". */
export function weeksOutText(weeksOut: number): string {
  return `Out about ${String(weeksOut)} ${weeksOut === 1 ? 'week' : 'weeks'}`;
}

/** "Sprained ankle (legs)": the injury and the body part it is on. */
export function injuryWhatText(kindLabel: string, bodyPart: BodyPart): string {
  return `${kindLabel} (${BODY_PART_LABELS[bodyPart].toLowerCase()})`;
}

export interface InjuryBannerProps {
  /** The worker's ring name. */
  readonly name: string;
  readonly bodyPart: BodyPart;
  /** The injury's name, such as "Sprained ankle". */
  readonly kindLabel: string;
  /** Whole weeks out, rounded up (`match.segmentInjuries`'s `weeksOut`). */
  readonly weeksOut: number;
  /** The match's injury chance for them, 0..1, or null once it is no longer kept. */
  readonly chance: number | null;
  /** The injury chance's Why?, or null once it is no longer kept. */
  readonly chanceTraceRef: TraceRef | null;
  /** How long they are out and why (WRK6's injury outcome), or null once it is no longer kept. */
  readonly injuryTraceRef: TraceRef | null;
  /** Draws the name, such as a `WorkerLink`. Plain text by default. */
  readonly renderName?: (name: string) => ReactNode;
  readonly className?: string;
}

/**
 * A worker hurt in a match (MTCH4-06), in the broadcast kit next to `LowerThird`: an "Injured"
 * kicker with the bandage icon, the worker's name, the injury and the body part, "Out about N
 * weeks" with the injury's Why?, and the match's injury chance with its Why?. The danger colour
 * only repeats what the text says. It slides in once, unless the player prefers less motion.
 */
export function InjuryBanner({
  name,
  bodyPart,
  kindLabel,
  weeksOut,
  chance,
  chanceTraceRef,
  injuryTraceRef,
  renderName,
  className,
}: InjuryBannerProps) {
  const weeksText = weeksOutText(weeksOut);
  return (
    <section
      className={classNames(styles['banner'], className)}
      aria-label={`${INJURED_KICKER}: ${name}`}
      data-part="injury"
    >
      <p className={styles['kicker']}>
        <Icon name="injured" decorative />
        {INJURED_KICKER}
      </p>
      <p className={styles['who']}>
        <strong className={styles['name']}>
          {renderName === undefined ? name : renderName(name)}
        </strong>
        <span className={styles['what']}>{injuryWhatText(kindLabel, bodyPart)}</span>
      </p>
      <ul className={styles['chips']} aria-label="Injury details">
        <li className={styles['chip']} data-kind="weeks">
          <Explained label={`${name}'s time out`} value={weeksText} traceRef={injuryTraceRef} />
        </li>
        {chance !== null && (
          <li className={styles['chip']} data-kind="chance">
            <span className={styles['chipLabel']}>Injury chance</span>
            <Explained
              label={`${name}'s injury chance`}
              value={chance}
              unit="probability"
              traceRef={chanceTraceRef}
            />
          </li>
        )}
      </ul>
    </section>
  );
}
