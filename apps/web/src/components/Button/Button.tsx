import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/** Native button attributes the component manages itself, or that styling rules forbid. */
type ManagedButtonAttribute = 'style' | 'aria-busy';

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  ManagedButtonAttribute
> {
  /** `secondary` by default. Use one `primary` per area for the main action. */
  readonly variant?: ButtonVariant;
  /** `md` by default. */
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
        {iconStart !== undefined && <Icon name={iconStart} />}
        {children}
        {iconEnd !== undefined && <Icon name={iconEnd} />}
      </span>
      {loading && <span className={styles['spinner']} aria-hidden="true" />}
    </button>
  );
});
