import { Badge } from '@/components/Badge';
import type { Tone } from '@/components/tone';
import { contrastLevel, contrastRatio, isOpaqueHex } from '../contrast';
import type { ContrastLevel } from '../contrast';
import type { GalleryEntry } from '../galleryEntry';
import { colourTokens } from '../tokenCatalog';
import { useEffectiveTheme } from '../useThemeState';
import styles from './entries.module.css';

const LEVEL_TONES: Readonly<Record<ContrastLevel, Tone>> = {
  AA: 'positive',
  'AA large': 'warning',
  'Below 3:1': 'neutral',
};

interface ContrastLineProps {
  readonly label: string;
  readonly foreground: string | undefined;
  readonly background: string | undefined;
}

function ContrastLine({ label, foreground, background }: ContrastLineProps) {
  if (
    foreground === undefined ||
    background === undefined ||
    !isOpaqueHex(foreground) ||
    !isOpaqueHex(background)
  ) {
    return <span className={styles['contrastLine']}>{label}: translucent, no ratio</span>;
  }
  const ratio = contrastRatio(foreground, background);
  const level = contrastLevel(ratio);
  return (
    <span className={styles['contrastLine']}>
      {label}: {ratio.toFixed(2)}:1 <Badge tone={LEVEL_TONES[level]}>{level}</Badge>
    </span>
  );
}

function ColourSwatches() {
  const theme = useEffectiveTheme();
  const tokens = colourTokens(theme);
  const background = tokens.find((token) => token.name === '--color-bg')?.hex;
  const surface = tokens.find((token) => token.name === '--color-surface')?.hex;

  return (
    <div className={styles['example']}>
      <p className={styles['caption']}>
        Showing the {theme} theme. Ratios are WCAG 2 contrast against the page background and a
        panel surface.
      </p>
      <ul className={styles['swatchGrid']}>
        {tokens.map((token) => (
          <li key={token.name} className={styles['swatchCard']}>
            <svg className={styles['swatch']} viewBox="0 0 44 44" aria-hidden="true">
              <rect
                className={styles['swatchFill']}
                x="0.5"
                y="0.5"
                width="43"
                height="43"
                rx="6"
                fill={token.hex ?? 'none'}
              />
            </svg>
            <div className={styles['tokenName']}>
              <span className={styles['mono']}>{token.name}</span>
              <span className={styles['mono']}>{token.hex ?? 'not a hex value'}</span>
              <ContrastLine label="on bg" foreground={token.hex} background={background} />
              <ContrastLine label="on surface" foreground={token.hex} background={surface} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-colours',
  title: 'Colours',
  group: 'Tokens',
  notes:
    'Every --color-* token, read from tokens.css for the theme on screen. Backgrounds, surfaces ' +
    'and borders are not meant to pass as text; text, status and focus colours are.',
  render: () => <ColourSwatches />,
};
