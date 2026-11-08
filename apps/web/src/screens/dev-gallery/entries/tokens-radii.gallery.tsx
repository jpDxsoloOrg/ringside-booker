import type { GalleryEntry } from '../galleryEntry';
import { baseTokens, remValue } from '../tokenCatalog';
import styles from './entries.module.css';

/** Tile size in rem; the SVG's units are rem, so each radius is drawn at true size. */
const TILE_REM = 4;

function RadiusScale() {
  return (
    <ul className={styles['tokenList']}>
      {baseTokens('--radius-').map((token) => {
        const rem = remValue(token.value) ?? 0;
        return (
          <li key={token.name} className={styles['tokenRow']}>
            <div className={styles['tokenName']}>
              <span className={styles['mono']}>{token.name}</span>
              <span className={styles['caption']}>{token.value}</span>
            </div>
            <svg
              className={styles['radiusTile']}
              viewBox={`0 0 ${String(TILE_REM)} ${String(TILE_REM)}`}
              aria-hidden="true"
            >
              {/* SVG caps rx at half the width, which is what the pill radius relies on. */}
              <rect
                className={styles['radiusFill']}
                x="0.03"
                y="0.03"
                width={TILE_REM - 0.06}
                height={TILE_REM - 0.06}
                rx={rem}
              />
            </svg>
          </li>
        );
      })}
    </ul>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-radii',
  title: 'Radii',
  group: 'Tokens',
  render: () => <RadiusScale />,
};
