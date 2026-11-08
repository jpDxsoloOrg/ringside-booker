import { classNames } from '../classNames';
import styles from './Icon.module.css';
import { ICON_GLYPHS } from './icons';
import type { IconName } from './icons';

export type IconSize = 'inherit' | 'sm' | 'md' | 'lg';

interface IconBaseProps {
  /** Which icon to draw. */
  readonly name: IconName;
  /** `inherit` (the default) follows the surrounding font size. */
  readonly size?: IconSize;
  readonly className?: string | undefined;
}

/**
 * An icon that repeats what the text next to it already says. It is hidden from assistive
 * technology.
 */
export interface DecorativeIconProps extends IconBaseProps {
  readonly decorative: true;
  readonly label?: never;
}

/** An icon that carries meaning on its own. It is announced as an image named by `label`. */
export interface LabelledIconProps extends IconBaseProps {
  readonly label: string;
  readonly decorative?: never;
}

/**
 * Every icon is either explicitly decorative or has a label, so an icon that means something can
 * never ship without an accessible name.
 */
export type IconProps = DecorativeIconProps | LabelledIconProps;

/** An inline SVG icon drawn from Lucide. Colour comes from `currentColor`. */
export function Icon(props: IconProps) {
  const { name, size = 'inherit', className } = props;
  const Glyph = ICON_GLYPHS[name];
  const iconClassName = classNames(styles['icon'], styles[`size-${size}`], className);

  if (props.label === undefined) {
    return (
      <Glyph className={iconClassName} aria-hidden="true" focusable="false" data-icon={name} />
    );
  }

  return (
    <Glyph
      className={iconClassName}
      role="img"
      aria-label={props.label}
      focusable="false"
      data-icon={name}
    />
  );
}
