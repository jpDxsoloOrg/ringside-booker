import styles from '../ImageSlot.module.css';
import { PLACEHOLDER_SALT, hashString, pick } from '../hash';
import { initialsFor } from '../initials';
import type { ImageTier } from '../types';
import { PlaceholderSvg, fitText } from './shared';
import type { PlaceholderProps } from './shared';

type PlateShape = 'oval' | 'shield' | 'hexagon' | 'circle';

const PLATE_SHAPES: readonly PlateShape[] = ['oval', 'shield', 'hexagon', 'circle'];

const METAL_FILLS: Readonly<Record<ImageTier, string | undefined>> = {
  gold: styles['metalGold'],
  silver: styles['metalSilver'],
  bronze: styles['metalBronze'],
  plain: styles['metalPlain'],
};

const FONT_SIZE = 13;
const MAX_TEXT_WIDTH = 24;

/** The centre plate is drawn at its base size and scaled up about the middle of the box. */
const PLATE_TRANSFORM = 'translate(32 32) scale(1.15) translate(-32 -32)';

function CentrePlate({
  shape,
  metal,
}: {
  readonly shape: PlateShape;
  readonly metal: string | undefined;
}) {
  switch (shape) {
    case 'oval':
      return <ellipse cx="32" cy="32" rx="15" ry="18" className={metal} />;
    case 'shield':
      return <path d="M17 15 H47 V31 C47 41 40 47 32 50 C24 47 17 41 17 31 Z" className={metal} />;
    case 'hexagon':
      return <polygon points="32,13 48,22.5 48,41.5 32,51 16,41.5 16,22.5" className={metal} />;
    case 'circle':
      return <circle cx="32" cy="32" r="17" className={metal} />;
  }
}

function SidePlate({ x, metal }: { readonly x: number; readonly metal: string | undefined }) {
  return <rect x={x} y="23" width="10" height="18" rx="2" className={metal} />;
}

/** A generic championship belt: strap, two side plates and a centre plate engraved with initials. */
export function Belt({ subject, decorative }: PlaceholderProps) {
  const seed = hashString(subject.id);
  const shape = pick(PLATE_SHAPES, seed, PLACEHOLDER_SALT.beltPlate);
  const metal = METAL_FILLS[subject.tier ?? 'plain'];
  const engraving = initialsFor(subject.shortName ?? subject.name);
  return (
    <PlaceholderSvg label={subject.name} decorative={decorative} generator={`belt-${shape}`}>
      <rect x="1" y="19" width="62" height="26" rx="7" className={styles['strap']} />
      <SidePlate x={2} metal={metal} />
      <SidePlate x={52} metal={metal} />
      <g transform={PLATE_TRANSFORM}>
        <CentrePlate shape={shape} metal={metal} />
        <path d="M22 24 H42 M22 40 H42" className={styles['engravingLine']} />
      </g>
      <text
        x="32"
        y="32.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={FONT_SIZE}
        className={styles['engraving']}
        {...fitText(engraving, FONT_SIZE, MAX_TEXT_WIDTH)}
      >
        {engraving}
      </text>
    </PlaceholderSvg>
  );
}
