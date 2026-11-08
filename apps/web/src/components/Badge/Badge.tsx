import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { toneRole } from '../tone';
import type { Tone } from '../tone';
import styles from './Badge.module.css';

export type BadgeVariant = 'soft' | 'solid';

export interface BadgeProps {
  /**
   * Colour meaning, one of the roles in `tone.ts`: `neutral` (the default), `data`, `action`,
   * `prestige`, `positive` or `negative`. The older names `info`, `warning` and `accent` still
   * work and draw as `data`, `prestige` and `action`.
   */
  readonly tone?: Tone;
  /** `soft` (outlined, the default) for labels in dense rows; `solid` for something to notice. */
  readonly variant?: BadgeVariant;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** A short status chip such as "Injured", "Champion" or "Filled". */
export function Badge({ tone = 'neutral', variant = 'soft', className, children }: BadgeProps) {
  return (
    <span
      className={classNames(
        styles['badge'],
        styles[variant],
        styles[`tone-${toneRole(tone)}`],
        className,
      )}
    >
      {children}
    </span>
  );
}
