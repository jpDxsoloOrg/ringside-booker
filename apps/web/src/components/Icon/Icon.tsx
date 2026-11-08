import { useId } from 'react';
import { classNames } from '../classNames';
import styles from './Icon.module.css';
import { ICON_PATHS } from './icons';
import type { IconName } from './icons';

export type IconSize = 'inherit' | 'sm' | 'md' | 'lg';

export interface IconProps {
  /** Which icon to draw. */
  readonly name: IconName;
  /**
   * Accessible name. Without one the icon is decoration and hidden from assistive technology,
   * which is right whenever text next to it already says the same thing.
   */
  readonly title?: string;
  /** `inherit` (the default) follows the surrounding font size. */
  readonly size?: IconSize;
  readonly className?: string | undefined;
}

/** An inline SVG icon from the game's own small set. Colour comes from `currentColor`. */
export function Icon({ name, title, size = 'inherit', className }: IconProps) {
  const titleId = useId();
  const paths = ICON_PATHS[name].map((path) => <path key={path} d={path} />);
  const iconClassName = classNames(styles['icon'], styles[`size-${size}`], className);

  if (title === undefined) {
    return (
      <svg
        className={iconClassName}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
        data-icon={name}
      >
        {paths}
      </svg>
    );
  }

  return (
    <svg
      className={iconClassName}
      viewBox="0 0 24 24"
      role="img"
      aria-labelledby={titleId}
      focusable="false"
      data-icon={name}
    >
      <title id={titleId}>{title}</title>
      {paths}
    </svg>
  );
}
