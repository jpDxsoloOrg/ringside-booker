import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './Tooltip.module.css';

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

/** How long the pointer rests on the trigger before the tooltip shows, in milliseconds. */
export const TOOLTIP_DELAY_MS = 400;

export interface TooltipProps {
  /** A short hint, a few words. Anything longer or interactive belongs in a `Popover`. */
  readonly content: ReactNode;
  /**
   * The one element the tooltip describes. It must take focus and forward its ref, as `Button`,
   * `IconButton` and plain elements do.
   */
  readonly children: ReactElement;
  /** Preferred side; it flips when there is no room. `top` by default. */
  readonly side?: TooltipSide;
  /** `TOOLTIP_DELAY_MS` by default. Keyboard focus shows it at once. */
  readonly delayMs?: number;
  readonly className?: string;
}

/**
 * A small hint that names or explains a control. It shows on hover after a short delay and at
 * once on keyboard focus, hides on Escape, blur or pointer leave, and is announced as the
 * trigger's description.
 *
 * Touch screens have no hover, so a tooltip must never hold the only copy of something the
 * player needs: put that in the control's label or in a `Popover`.
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  delayMs = TOOLTIP_DELAY_MS,
  className,
}: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={classNames(styles['tooltip'], className)}
          >
            {content}
            <RadixTooltip.Arrow className={styles['arrow']} width={10} height={5} />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
