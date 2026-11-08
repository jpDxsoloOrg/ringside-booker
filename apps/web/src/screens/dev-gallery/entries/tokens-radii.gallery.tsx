import { classNames } from '@/components/classNames';
import type { GalleryEntry } from '../galleryEntry';
import { baseLengthInPx, baseTokens, tokenCatalog } from '../tokenCatalog';
import type { TokenDeclaration } from '../tokenCatalog';
import styles from './entries.module.css';

/** Tile size in CSS pixels; the SVG's units are px, so each radius is drawn at true size. */
const TILE_PX = 64;

/** The broadcast shape tokens, each with the preview class that uses it. */
const BROADCAST_SHAPES: readonly { readonly name: string; readonly previewClass: string }[] = [
  { name: '--chamfer', previewClass: 'chamferPreview' },
  { name: '--skew-broadcast', previewClass: 'skewPreview' },
];

/** The glow tokens live in the theme block, since their colours follow the theme. */
function glowTokens(): readonly TokenDeclaration[] {
  return tokenCatalog.themes.dark.filter((token) => token.name.startsWith('--glow-'));
}

function baseTokenValue(name: string): string {
  return tokenCatalog.base.find((token) => token.name === name)?.value ?? 'not defined';
}

function RadiusScale() {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>Radii (office)</h3>
      <ul className={styles['tokenList']}>
        {baseTokens('--radius-').map((token) => {
          const radiusPx = baseLengthInPx(token.name) ?? 0;
          return (
            <li key={token.name} className={styles['tokenRow']}>
              <div className={styles['tokenName']}>
                <span className={styles['mono']}>{token.name}</span>
                <span className={styles['caption']}>{token.value}</span>
              </div>
              <svg
                className={styles['radiusTile']}
                viewBox={`0 0 ${String(TILE_PX)} ${String(TILE_PX)}`}
                aria-hidden="true"
              >
                {/* SVG caps rx at half the width, which is what the pill radius relies on. */}
                <rect
                  className={styles['radiusFill']}
                  x="0.5"
                  y="0.5"
                  width={TILE_PX - 1}
                  height={TILE_PX - 1}
                  rx={radiusPx}
                />
              </svg>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BroadcastShapes() {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>Broadcast shapes</h3>
      <ul className={styles['tokenList']}>
        {BROADCAST_SHAPES.map((shape) => (
          <li key={shape.name} className={styles['tokenRow']}>
            <div className={styles['tokenName']}>
              <span className={styles['mono']}>{shape.name}</span>
              <span className={styles['caption']}>{baseTokenValue(shape.name)}</span>
            </div>
            <div className={classNames(styles['shapePreview'], styles[shape.previewClass])}>
              <span className={styles['shapePreviewLabel']}>Up next</span>
            </div>
          </li>
        ))}
        {glowTokens().map((token) => (
          <li key={token.name} className={styles['tokenRow']}>
            <div className={styles['tokenName']}>
              <span className={styles['mono']}>{token.name}</span>
              <span className={styles['caption']}>{token.value}</span>
            </div>
            <div className={classNames(styles['shapePreview'], styles[token.name.slice(2)])}>
              <span className={styles['shapePreviewLabel']}>Live</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShapeTokens() {
  return (
    <div className={styles['example']}>
      <RadiusScale />
      <BroadcastShapes />
    </div>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-radii',
  title: 'Shape',
  group: 'Tokens',
  notes:
    'Office screens use rounded cards (10px), controls (8px) and pill chips. Show moments use ' +
    'square corners with an 8px chamfer, a -12° skew on bugs (the text inside is un-skewed) and ' +
    'glows for live states.',
  render: () => <ShapeTokens />,
};
