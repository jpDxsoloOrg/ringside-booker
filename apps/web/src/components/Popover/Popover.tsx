import * as RadixPopover from '@radix-ui/react-popover';
import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import { firstOpenFocusIn } from '../Sheet';
import styles from './Popover.module.css';

export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';
export type PopoverAlign = 'start' | 'center' | 'end';

interface PopoverSharedProps {
  /**
   * The button that opens it. It must forward its ref, as `Button` and `IconButton` do. Radix
   * adds `aria-expanded` and `aria-controls` to it.
   */
  readonly trigger: ReactElement;
  /** Shown at the top and names the popover for screen readers. */
  readonly title: ReactNode;
  /** Preferred side; it flips when there is no room. `bottom` by default. */
  readonly side?: PopoverSide;
  /** `start` by default. */
  readonly align?: PopoverAlign;
  /** Accessible name of the Close button. `Close` by default. */
  readonly closeLabel?: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export interface ControlledPopoverProps extends PopoverSharedProps {
  readonly open: boolean;
  /** Called with the new open state: the trigger, Escape, Close or a click outside. */
  readonly onOpenChange: (open: boolean) => void;
}

export interface UncontrolledPopoverProps extends PopoverSharedProps {
  readonly open?: never;
  readonly onOpenChange?: (open: boolean) => void;
}

/** Either controlled (`open` + `onOpenChange`) or left to manage itself. */
export type PopoverProps = ControlledPopoverProps | UncontrolledPopoverProps;

/** Focus the first control in the body; with none, the popover itself. Never the Close button. */
function focusPopoverBody(event: Event): void {
  const content = event.currentTarget;
  if (!(content instanceof HTMLElement)) return;
  event.preventDefault();
  (firstOpenFocusIn(content.querySelector('[data-popover-body]')) ?? content).focus();
}

/**
 * A small panel anchored to a button, for extra detail or a few quick controls: a "Why?" summary,
 * a filter, a short form. It is not modal: focus moves into it on open and back to the trigger on
 * close, Escape or a click outside closes it, and the page behind stays usable.
 *
 * It keeps to the screen on a phone, capped to the viewport width and the room below or above.
 */
export function Popover({
  trigger,
  title,
  side = 'bottom',
  align = 'start',
  closeLabel = 'Close',
  className,
  children,
  open,
  onOpenChange,
}: PopoverProps) {
  const titleId = useId();
  const openState = open === undefined ? {} : { open };
  const changeHandler = onOpenChange === undefined ? {} : { onOpenChange };

  return (
    <RadixPopover.Root {...openState} {...changeHandler}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          aria-labelledby={titleId}
          onOpenAutoFocus={focusPopoverBody}
          className={classNames(styles['popover'], className)}
        >
          <div className={styles['header']}>
            <h2 id={titleId} className={styles['title']}>
              {title}
            </h2>
            <RadixPopover.Close asChild>
              <IconButton icon="close" label={closeLabel} size="sm" />
            </RadixPopover.Close>
          </div>
          <div className={styles['body']} data-popover-body="">
            {children}
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
