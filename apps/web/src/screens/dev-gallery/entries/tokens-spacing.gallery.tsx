import type { GalleryEntry } from '../galleryEntry';
import { baseTokens, remValue } from '../tokenCatalog';
import styles from './entries.module.css';

/** Bar height in rem. */
const BAR_HEIGHT_REM = 0.75;

function SpacingScale() {
  return (
    <ul className={styles['tokenList']}>
      {baseTokens('--space-').map((token) => {
        const rem = remValue(token.value);
        return (
          <li key={token.name} className={styles['tokenRow']}>
            <div className={styles['tokenName']}>
              <span className={styles['mono']}>{token.name}</span>
              <span className={styles['caption']}>{token.value}</span>
            </div>
            {rem === undefined || rem === 0 ? (
              <span className={styles['caption']}>no bar</span>
            ) : (
              // Drawn at true size: the SVG is `rem` wide, so the bar grows with the UI scale.
              <svg
                width={`${String(rem)}rem`}
                height={`${String(BAR_HEIGHT_REM)}rem`}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <rect className={styles['tokenShape']} width="1" height="1" />
              </svg>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-spacing',
  title: 'Spacing',
  group: 'Tokens',
  notes: 'A 0.25rem step. Layout gaps (Stack, Cluster) take the step number, never a raw length.',
  render: () => <SpacingScale />,
};
