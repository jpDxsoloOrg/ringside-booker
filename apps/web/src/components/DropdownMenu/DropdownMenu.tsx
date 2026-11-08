import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { useId } from 'react';
import type { ReactElement } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { RETURN_FOCUS_ATTRIBUTE } from '../Sheet';
import styles from './DropdownMenu.module.css';

/** `danger` for destructive actions such as Release or Delete. */
export type DropdownMenuItemTone = 'default' | 'danger';

/** One action in the menu. */
export interface DropdownMenuAction {
  readonly kind: 'item';
  /** Stable and unique within the menu; used as the React key. */
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  /** Runs when the item is chosen by click, Enter or Space. The menu then closes. */
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** `default` by default. */
  readonly tone?: DropdownMenuItemTone;
}

/** A divider between groups of actions. */
export interface DropdownMenuSeparator {
  readonly kind: 'separator';
  readonly id: string;
}

export type DropdownMenuEntry = DropdownMenuAction | DropdownMenuSeparator;

export type DropdownMenuAlign = 'start' | 'center' | 'end';

export interface DropdownMenuProps {
  /**
   * The button that opens the menu. It must forward its ref, as `Button` and `IconButton` do.
   * Radix adds `aria-haspopup`, `aria-expanded` and the keyboard handling to it.
   */
  readonly trigger: ReactElement;
  /** The actions and separators, in order. */
  readonly items: readonly DropdownMenuEntry[];
  /** Accessible name for the menu. The trigger's name is used when this is left out. */
  readonly label?: string;
  /** Edge of the trigger the menu lines up with. `end` by default, for row and toolbar menus. */
  readonly align?: DropdownMenuAlign;
  readonly className?: string;
}

/**
 * A menu of actions behind a button, such as the "more" menu on a roster row. Built on Radix
 * DropdownMenu: Enter, Space or Down on the trigger opens it with the first item focused, Up and
 * Down move (wrapping), Home and End jump, typing a letter jumps to a matching item, and Escape
 * closes it and puts focus back on the trigger.
 */
export function DropdownMenu({
  trigger,
  items,
  label,
  align = 'end',
  className,
}: DropdownMenuProps) {
  // Our own trigger id, so the menu can name itself after the trigger and so a Sheet or
  // ConfirmDialog opened from an item hands focus back to the trigger once the item is gone.
  const triggerId = useId();
  // The menu is named after its trigger; an explicit label takes that name's place.
  const menuName =
    label === undefined
      ? { 'aria-labelledby': triggerId }
      : { 'aria-label': label, 'aria-labelledby': undefined };

  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild id={triggerId}>
        {trigger}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          loop
          {...menuName}
          {...{ [RETURN_FOCUS_ATTRIBUTE]: triggerId }}
          className={classNames(styles['menu'], className)}
        >
          {items.map((entry) =>
            entry.kind === 'separator' ? (
              <RadixMenu.Separator key={entry.id} className={styles['separator']} />
            ) : (
              <RadixMenu.Item
                key={entry.id}
                disabled={entry.disabled ?? false}
                onSelect={entry.onSelect}
                className={styles['item']}
                data-tone={entry.tone ?? 'default'}
              >
                {entry.icon !== undefined && (
                  <Icon name={entry.icon} className={styles['itemIcon']} decorative />
                )}
                <span className={styles['itemLabel']}>{entry.label}</span>
              </RadixMenu.Item>
            ),
          )}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
