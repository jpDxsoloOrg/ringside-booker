import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import styles from './Button.module.css';
import type { ButtonSize, ButtonVariant } from './Button';

type ManagedIconButtonAttribute = 'style' | 'aria-label' | 'title' | 'children';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  ManagedIconButtonAttribute
> {
  /** The icon shown in the button. */
  readonly icon: IconName;
  /**
   * What the button does, in words. Required: an icon on its own has no accessible name. It
   * becomes the button's `aria-label` and its hover tooltip (`title`).
   */
  readonly label: string;
  /** `ghost` by default, the usual look for toolbar and row actions. */
  readonly variant?: ButtonVariant;
  /** `md` by default. */
  readonly size?: ButtonSize;
}

/** A square button that shows only an icon. The required `label` names it. It forwards its ref. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', type = 'button', className, ...buttonAttributes },
  ref,
) {
  return (
    <button
      {...buttonAttributes}
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={classNames(
        styles['button'],
        styles['iconOnly'],
        styles[`variant-${variant}`],
        styles[`size-${size}`],
        className,
      )}
    >
      <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} decorative />
    </button>
  );
});
