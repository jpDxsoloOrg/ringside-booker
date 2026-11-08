import type { ReactNode } from 'react';
import styles from '../ImageSlot.module.css';
import { PLACEHOLDER_SALT, hashString, pick } from '../hash';
import { graphemesOf, initialsFor } from '../initials';
import type { ImageSubject } from '../types';
import { CATEGORY_FILLS, PlaceholderSvg, fitText } from './shared';
import type { PlaceholderProps } from './shared';

type LogoShape = 'circle' | 'shield' | 'star-burst' | 'diamond' | 'hexagon';

const LOGO_SHAPES: readonly LogoShape[] = ['circle', 'shield', 'star-burst', 'diamond', 'hexagon'];

/** A 12-point burst, outer radius 30 and inner radius 24.5, precomputed so it never drifts. */
const STAR_BURST_POINTS =
  '32,2 38.34,8.33 47,6.02 49.32,14.68 57.98,17 55.67,25.66 62,32 55.67,38.34 57.98,47 ' +
  '49.32,49.32 47,57.98 38.34,55.67 32,62 25.66,55.67 17,57.98 14.68,49.32 6.02,47 8.33,38.34 ' +
  '2,32 8.33,25.66 6.02,17 14.68,14.68 17,6.02 25.66,8.33';

/** The inner mark is the outer shape scaled down about the centre. */
const INNER_TRANSFORM = 'translate(32 32) scale(0.66) translate(-32 -32)';

const MAX_MONOGRAM_LETTERS = 3;
const MAX_TEXT_WIDTH = 30;

function LogoShapePath({
  shape,
  fill,
}: {
  readonly shape: LogoShape;
  readonly fill: string | undefined;
}): ReactNode {
  switch (shape) {
    case 'circle':
      return <circle cx="32" cy="32" r="29" className={fill} />;
    case 'shield':
      return <path d="M7 5 H57 V30 C57 46 45 56 32 61 C19 56 7 46 7 30 Z" className={fill} />;
    case 'star-burst':
      return <polygon points={STAR_BURST_POINTS} className={fill} />;
    case 'diamond':
      return <polygon points="32,2 62,32 32,62 2,32" className={fill} />;
    case 'hexagon':
      return (
        <polygon points="32,3 57.11,17.5 57.11,46.5 32,61 6.89,46.5 6.89,17.5" className={fill} />
      );
  }
}

/** Up to three letters: the short name (an acronym as written, or its initials), else the name. */
export function monogramFor(subject: Pick<ImageSubject, 'name' | 'shortName'>): string {
  const shortName = subject.shortName?.trim() ?? '';
  if (shortName === '') return initialsFor(subject.name, MAX_MONOGRAM_LETTERS);
  if (/[\s-]/u.test(shortName)) return initialsFor(shortName, MAX_MONOGRAM_LETTERS);
  return graphemesOf(shortName).slice(0, MAX_MONOGRAM_LETTERS).join('').toLocaleUpperCase();
}

/** A geometric mark for promotions, brands, events and networks, with a monogram in the middle. */
export function LogoMark({ subject, decorative }: PlaceholderProps) {
  const seed = hashString(subject.id);
  const shape = pick(LOGO_SHAPES, seed, PLACEHOLDER_SALT.logoShape);
  const outerFill = pick(CATEGORY_FILLS, seed, PLACEHOLDER_SALT.background);
  // The inner colour is picked from the other seven, so the two are never the same.
  const innerFill = pick(
    CATEGORY_FILLS.filter((fill) => fill !== outerFill),
    seed,
    PLACEHOLDER_SALT.logoInner,
  );
  const monogram = monogramFor(subject);
  const fontSize = graphemesOf(monogram).length > 2 ? 15 : 18;
  return (
    <PlaceholderSvg label={subject.name} decorative={decorative} generator={`logo-${shape}`}>
      <LogoShapePath shape={shape} fill={outerFill} />
      <g transform={INNER_TRANSFORM}>
        <LogoShapePath shape={shape} fill={innerFill} />
      </g>
      <text
        x="32"
        y="33"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
        className={styles['lettering']}
        {...fitText(monogram, fontSize, MAX_TEXT_WIDTH)}
      >
        {monogram}
      </text>
    </PlaceholderSvg>
  );
}
