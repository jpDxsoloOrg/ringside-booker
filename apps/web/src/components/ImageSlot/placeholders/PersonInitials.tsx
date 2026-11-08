import styles from '../ImageSlot.module.css';
import { PLACEHOLDER_SALT, hashString, pick } from '../hash';
import { initialsFor } from '../initials';
import { CATEGORY_TINTS, PlaceholderSvg, fitText } from './shared';
import type { FrameShape, PlaceholderProps } from './shared';

const FONT_SIZE = 24;
/** Two wide glyphs fit inside the ring with a margin on each side of the 64-unit box. */
const MAX_TEXT_WIDTH = 38;
/**
 * The initials are set in the condensed display face, which runs about three quarters the width of
 * the bold system font `fitText` estimates for, so the estimate is scaled down to match. Without
 * this, ordinary initials such as "MQ" would be squeezed for no reason.
 */
const CONDENSED_WIDTH_RATIO = 0.75;
/** The ring's centre line sits this far in from the edge, so its whole stroke stays inside. */
const RING_INSET = 2.5;
/** Corner radius of the ring in a square frame, close to the frame's own small radius. */
const SQUARE_RING_RADIUS = 6;

export interface PersonInitialsProps extends PlaceholderProps {
  /** The ring follows the frame: a circle in a circle frame, a rounded square in a square one. */
  readonly frameShape?: FrameShape;
}

/**
 * A person's initials inside a ring, both in a category colour seeded from their id, on the raised
 * surface. This is the ringed-initials look from the mockups; the colour survives a rename because
 * it comes from the id, not the name.
 */
export function PersonInitials({
  subject,
  decorative,
  frameShape = 'circle',
}: PersonInitialsProps) {
  const seed = hashString(subject.id);
  const initials = initialsFor(subject.name);
  const ringSize = 64 - RING_INSET * 2;
  return (
    <PlaceholderSvg label={subject.name} decorative={decorative} generator="person-initials">
      <rect x="0" y="0" width="64" height="64" className={styles['ringBackground']} />
      <g className={pick(CATEGORY_TINTS, seed, PLACEHOLDER_SALT.background)}>
        {frameShape === 'circle' ? (
          <circle cx="32" cy="32" r={ringSize / 2} className={styles['ring']} />
        ) : (
          <rect
            x={RING_INSET}
            y={RING_INSET}
            width={ringSize}
            height={ringSize}
            rx={SQUARE_RING_RADIUS}
            className={styles['ring']}
          />
        )}
        <text
          x="32"
          y="33"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={FONT_SIZE}
          className={styles['ringLettering']}
          {...fitText(initials, FONT_SIZE * CONDENSED_WIDTH_RATIO, MAX_TEXT_WIDTH)}
        >
          {initials}
        </text>
      </g>
    </PlaceholderSvg>
  );
}
