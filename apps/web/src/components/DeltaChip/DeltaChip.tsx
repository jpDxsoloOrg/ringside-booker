import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { formatSigned } from '../format';
import styles from './DeltaChip.module.css';

export type DeltaDirection = 'up' | 'down' | 'flat';

/** Which way is good news for the number: most stats are better up, a payroll is better down. */
export type DeltaGoodWhen = 'up' | 'down';

export type DeltaTone = 'positive' | 'negative' | 'neutral';

/** `chip` is the outlined pill for KPI cards; `plain` is the bare arrow and number for tables. */
export type DeltaChipVariant = 'chip' | 'plain';

export interface DeltaChipProps {
  /** The change. Its sign picks the arrow; zero (or a value that rounds to zero) is flat. */
  readonly value: number;
  /**
   * The change already formatted, such as `+4.2%` or `−$12K`. Include the sign. Left out, the
   * value is formatted with `formatSigned` (a true minus sign, so signed columns line up).
   */
  readonly display?: string;
  /** Small text after the number, such as "vs last month". */
  readonly suffix?: ReactNode;
  /** `up` by default. With `down`, a fall is drawn in the positive colour and a rise in the negative. */
  readonly goodWhen?: DeltaGoodWhen;
  /** `chip` (the default) or `plain`. */
  readonly variant?: DeltaChipVariant;
  readonly className?: string | undefined;
}

/** The arrow for each direction. Flat has none: the neutral colour and a plain "0" say it. */
const DIRECTION_ARROWS: Readonly<Record<DeltaDirection, string | null>> = {
  up: '▲',
  down: '▼',
  flat: null,
};

/** Up, down or flat, judged on the text a player would see so "+0" never gets an arrow. */
export function deltaDirection(value: number, display: string): DeltaDirection {
  if (!Number.isFinite(value) || value === 0 || display === '0') return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** The colour role for a direction: good news is positive, bad news negative, no change neutral. */
export function deltaTone(direction: DeltaDirection, goodWhen: DeltaGoodWhen = 'up'): DeltaTone {
  if (direction === 'flat') return 'neutral';
  return direction === goodWhen ? 'positive' : 'negative';
}

/**
 * A change in a number: an arrow, the signed amount and an optional note, such as "▲ +3 vs last
 * month". The colour says good or bad news and the arrow and sign say which way it moved, so the
 * chip never relies on colour alone (docs/design/visual-identity.md). Rose, not the red-orange
 * action colour, marks bad news.
 */
export function DeltaChip({
  value,
  display,
  suffix,
  goodWhen = 'up',
  variant = 'chip',
  className,
}: DeltaChipProps) {
  const text = display ?? formatSigned(value);
  const direction = deltaDirection(value, text);
  const tone = deltaTone(direction, goodWhen);
  const arrow = DIRECTION_ARROWS[direction];

  return (
    <span
      className={classNames(
        styles['deltaChip'],
        styles[`variant-${variant}`],
        styles[`tone-${tone}`],
        className,
      )}
      data-direction={direction}
      data-tone={tone}
    >
      {arrow !== null && (
        <span className={styles['arrow']} aria-hidden="true">
          {arrow}
        </span>
      )}
      <span className={styles['amount']}>{text}</span>
      {suffix !== undefined && <span className={styles['suffix']}>{suffix}</span>}
    </span>
  );
}
