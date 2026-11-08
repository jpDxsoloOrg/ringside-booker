import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import styles from './Button.module.css';

/**
 * - `primary`: the action fill with white text. One per area, for the main action.
 * - `secondary`: a cyan outline. The default, for everything else.
 * - `prestige`: a gold fill with dark text, for title and award moments.
 * - `ghost`: no fill or outline, for toolbars and row actions.
 * - `danger`: a rose fill, for actions that destroy or release something.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'prestige' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Every variant and size, in the order the gallery shows them. */
export const BUTTON_VARIANTS: readonly ButtonVariant[] = [
  'primary',
  'secondary',
  'prestige',
  'ghost',
  'danger',
];
export const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

/** Native button attributes the component manages itself, or that styling rules forbid. */
type ManagedButtonAttribute = 'style' | 'aria-busy';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  ManagedButtonAttribute
> {
  /** `secondary` by default. Use one `primary` per area for the main action. */
  readonly variant?: ButtonVariant;
  /** `md` by default. On touch screens and at phone width every size is at least 44px tall. */
  readonly size?: ButtonSize;
  /**
   * Shows a spinner in place of the label, keeps the button's width, disables it and sets
   * `aria-busy="true"`, so a second click cannot fire while the first is still running.
   */
  readonly loading?: boolean;
  /** Icon before the label. */
  readonly iconStart?: IconName;
  /** Icon after the label. */
  readonly iconEnd?: IconName;
  readonly children: ReactNode;
}

/**
 * The game's standard button. Renders `<button type="button">` unless `type` says otherwise. It
 * forwards its ref, so it can be the trigger of a Tooltip, Popover or DropdownMenu.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconStart,
    iconEnd,
    type = 'button',
    disabled = false,
    className,
    children,
    ...buttonAttributes
  },
  ref,
) {
  return (
    <button
      {...buttonAttributes}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      className={classNames(
        styles['button'],
        styles[`variant-${variant}`],
        styles[`size-${size}`],
        loading && styles['loading'],
        className,
      )}
    >
      <span className={styles['content']}>
        {iconStart !== undefined && <Icon name={iconStart} decorative />}
        {children}
        {iconEnd !== undefined && <Icon name={iconEnd} decorative />}
      </span>
      {loading && <span className={styles['spinner']} aria-hidden="true" />}
    </button>
  );
});
