import { classNames } from '@/components/classNames';
import type { GalleryEntry } from '../galleryEntry';
import { baseTokens } from '../tokenCatalog';
import type { TokenDeclaration } from '../tokenCatalog';
import styles from './entries.module.css';

const SAMPLE_TEXT = 'The main event goes on last';
const LONG_SAMPLE_TEXT =
  'A hot opener sets the crowd up for the rest of the night, and the main event pays it off.';

interface TokenSampleListProps {
  readonly title: string;
  readonly tokens: readonly TokenDeclaration[];
  readonly sample: string;
}

/** One row per token: name and value, then the sample text set with that token's class. */
function TokenSampleList({ title, tokens, sample }: TokenSampleListProps) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <ul className={styles['tokenList']}>
        {tokens.map((token) => (
          <li key={token.name} className={styles['tokenRow']}>
            <div className={styles['tokenName']}>
              <span className={styles['mono']}>{token.name}</span>
              <span className={styles['caption']}>{token.value}</span>
            </div>
            <p className={classNames(styles['sample'], styles[token.name.slice(2)])}>{sample}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Barlow Condensed ships at 600, 700 and 800; each one set in the display face. */
const DISPLAY_WEIGHTS: readonly { readonly name: string }[] = [
  { name: '--font-weight-semibold' },
  { name: '--font-weight-bold' },
  { name: '--font-weight-extrabold' },
];

function TypeScale() {
  return (
    <div className={styles['example']}>
      <TokenSampleList title="Sizes" tokens={baseTokens('--font-size-')} sample={SAMPLE_TEXT} />
      <TokenSampleList title="Weights" tokens={baseTokens('--font-weight-')} sample={SAMPLE_TEXT} />
      <TokenSampleList
        title="Line heights"
        tokens={baseTokens('--line-height-')}
        sample={LONG_SAMPLE_TEXT}
      />
      <TokenSampleList
        title="Families"
        tokens={baseTokens('--font-family-')}
        sample="$1,234,567 · 48,210 fans · 2031-01-08"
      />
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Display weights</h3>
        <ul className={styles['tokenList']}>
          {DISPLAY_WEIGHTS.map((weight) => (
            <li key={weight.name} className={styles['tokenRow']}>
              <div className={styles['tokenName']}>
                <span className={styles['mono']}>--font-family-display</span>
                <span className={styles['caption']}>{weight.name}</span>
              </div>
              <p
                className={classNames(
                  styles['sample'],
                  styles['displaySample'],
                  styles[weight.name.slice(2)],
                )}
              >
                Main event · 8,450
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Tabular numbers</h3>
        <p className={styles['caption']}>
          The .tabular class (and every table cell) uses --font-feature-tabular, so digits share one
          width and columns of figures line up.
        </p>
        <p className={classNames(styles['sample'], 'tabular')}>
          1,111,111
          <br />
          8,888,888
        </p>
      </section>
    </div>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-type',
  title: 'Type scale',
  group: 'Tokens',
  notes:
    'Barlow Condensed (display: headings, labels, stat numbers) and Inter (body, tables, forms), ' +
    'both self-hosted. Sizes are in rem, so they follow the UI scale.',
  render: () => <TypeScale />,
};
