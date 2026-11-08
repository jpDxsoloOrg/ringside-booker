import styles from '../ImageSlot.module.css';
import { PLACEHOLDER_SALT, hashString, pick } from '../hash';
import { initialsFor } from '../initials';
import { CATEGORY_FILLS, PlaceholderSvg, fitText } from './shared';
import type { PlaceholderProps } from './shared';

const FONT_SIZE = 26;
/** Two wide glyphs fit inside this width with a margin on each side of the 64-unit box. */
const MAX_TEXT_WIDTH = 44;

/** A person's initials on a category colour seeded from their id. */
export function PersonInitials({ subject, decorative }: PlaceholderProps) {
  const seed = hashString(subject.id);
  const initials = initialsFor(subject.name);
  return (
    <PlaceholderSvg label={subject.name} decorative={decorative} generator="person-initials">
      <rect
        x="0"
        y="0"
        width="64"
        height="64"
        rx="12"
        className={pick(CATEGORY_FILLS, seed, PLACEHOLDER_SALT.background)}
      />
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={FONT_SIZE}
        className={styles['lettering']}
        {...fitText(initials, FONT_SIZE, MAX_TEXT_WIDTH)}
      >
        {initials}
      </text>
    </PlaceholderSvg>
  );
}
