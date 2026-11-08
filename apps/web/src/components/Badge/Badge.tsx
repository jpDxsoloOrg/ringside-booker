import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import type { Tone } from '../tone';
import styles from './Badge.module.css';

export type BadgeVariant = 'soft' | 'solid';

export interface BadgeProps {
  /** Colour meaning. `neutral` by default. */
  readonly tone?: Tone;
  /** `soft` (outlined, the default) for labels in dense rows; `solid` for something to notice. */
  readonly variant?: BadgeVariant;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** A short status label such as "Injured", "Champion" or "Heel". */
export function Badge({ tone = 'neutral', variant = 'soft', className, children }: BadgeProps) {
  return (
    <span
      className={classNames(styles['badge'], styles[variant], styles[`tone-${tone}`], className)}
    >
      {children}
    </span>
  );
}
