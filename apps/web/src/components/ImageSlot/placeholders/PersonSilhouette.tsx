import styles from '../ImageSlot.module.css';
import { PLACEHOLDER_SALT, hashString, pick } from '../hash';
import { CATEGORY_FILLS, PlaceholderSvg } from './shared';
import type { PlaceholderProps } from './shared';

/** Shoulders shared by every variant. */
const SHOULDERS = 'M10 64 C10 49 19 42 32 42 C45 42 54 49 54 64 Z';

function ShortHair({ figure }: { readonly figure: string | undefined }) {
  return (
    <g className={figure}>
      <path d={SHOULDERS} />
      <circle cx="32" cy="25" r="11" />
      {/* A spiky crop that sticks up above the head. */}
      <path d="M20.5 24 L20 13 L25 16.5 L27 9 L31 14 L34 8 L36.5 14.5 L41 10 L41.5 17 L45 15 L43.5 24 Z" />
    </g>
  );
}

function LongHair({ figure }: { readonly figure: string | undefined }) {
  return (
    <g className={figure}>
      {/* Hair falls behind the head down to the shoulders. */}
      <path d="M19 26 C19 14 25 10 32 10 C39 10 45 14 45 26 L47 45 L17 45 Z" />
      <path d={SHOULDERS} />
      <circle cx="32" cy="25" r="10.5" />
    </g>
  );
}

function Hooded({
  figure,
  background,
}: {
  readonly figure: string | undefined;
  readonly background: string | undefined;
}) {
  return (
    <>
      <g className={figure}>
        <path d={SHOULDERS} />
        {/* A peaked hood over the head. */}
        <path d="M17 46 C16 30 21 13 32 8 C43 13 48 30 47 46 Z" />
      </g>
      <ellipse cx="32" cy="28" rx="9" ry="11" className={background} />
      <g className={figure}>
        {/* A masked face inside the hood, with two eye holes. */}
        <ellipse cx="32" cy="29" rx="7" ry="9" />
      </g>
      <g className={background}>
        <ellipse cx="29" cy="27" rx="2.2" ry="1.3" />
        <ellipse cx="35" cy="27" rx="2.2" ry="1.3" />
      </g>
    </>
  );
}

type SilhouetteVariant = 'short-hair' | 'long-hair' | 'hooded';

const VARIANTS: readonly SilhouetteVariant[] = ['short-hair', 'long-hair', 'hooded'];

/** A generic head-and-shoulders outline, one of three variants, seeded from the person's id. */
export function PersonSilhouette({ subject, decorative }: PlaceholderProps) {
  const seed = hashString(subject.id);
  const background = pick(CATEGORY_FILLS, seed, PLACEHOLDER_SALT.background);
  const variant = pick(VARIANTS, seed, PLACEHOLDER_SALT.silhouette);
  const figure = styles['inverse'];
  return (
    <PlaceholderSvg
      label={subject.name}
      decorative={decorative}
      generator={`person-silhouette-${variant}`}
    >
      <rect x="0" y="0" width="64" height="64" rx="12" className={background} />
      {variant === 'short-hair' && <ShortHair figure={figure} />}
      {variant === 'long-hair' && <LongHair figure={figure} />}
      {variant === 'hooded' && <Hooded figure={figure} background={background} />}
    </PlaceholderSvg>
  );
}
