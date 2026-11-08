import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useReducedMotion } from '@/styles/useReducedMotion';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import styles from './LiveBugButton.module.css';

export type LiveBugButtonSize = 'md' | 'lg';

/** Native button attributes the component manages itself, or that styling rules forbid. */
type ManagedLiveBugAttribute = 'style' | 'aria-busy';

export interface LiveBugButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  ManagedLiveBugAttribute
> {
  /** `md` (the default) for a top bar; `lg` for the one big action on a screen or sidebar. */
  readonly size?: LiveBugButtonSize;
  /** Shows the pulsing dot. True by default; turn it off when nothing is live or waiting. */
  readonly live?: boolean;
  /**
   * The action is running (a day advancing, a show going live). The button is disabled and marked
   * busy, and the dot holds still, so a second press cannot fire while the first is running.
   */
  readonly busy?: boolean;
  /** Icon after the label, such as `next-day`. */
  readonly iconEnd?: IconName;
  readonly children: ReactNode;
}

/**
 * The broadcast register's main action: a skewed red-orange bug with a pulsing dot, used for
 * Next Day and for Go Live on show night. The shape is skewed and the label inside is drawn
 * straight. The dot is decorative; the label says what the button does. Under reduced motion the
 * dot stays lit but does not pulse. Forwards its ref, so it can be the trigger of a Tooltip.
 */
export const LiveBugButton = forwardRef<HTMLButtonElement, LiveBugButtonProps>(
  function LiveBugButton(
    {
      size = 'md',
      live = true,
      busy = false,
      iconEnd,
      type = 'button',
      disabled = false,
      className,
      children,
      ...buttonAttributes
    },
    ref,
  ) {
    const reducedMotion = useReducedMotion();
    const pulsing = live && !busy && !disabled && !reducedMotion;

    return (
      <button
        {...buttonAttributes}
        ref={ref}
        type={type}
        disabled={disabled || busy}
        aria-busy={busy ? true : undefined}
        className={classNames(styles['bug'], styles[`size-${size}`], className)}
      >
        <span className={styles['content']}>
          {live && (
            <span
              className={classNames(styles['dot'], pulsing && styles['pulse'])}
              data-part="dot"
              data-motion={pulsing ? 'pulse' : 'static'}
              aria-hidden="true"
            />
          )}
          <span className={styles['label']}>{children}</span>
          {iconEnd !== undefined && <Icon name={iconEnd} decorative />}
        </span>
      </button>
    );
  },
);
