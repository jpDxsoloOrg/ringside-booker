import breakpointsCss from '@/styles/breakpoints.css?raw';
import { useMediaQuery } from '@/styles/useMediaQuery';
import type { GalleryEntry } from '../galleryEntry';
import { baseTokens } from '../tokenCatalog';
import styles from './entries.module.css';

interface CustomMedia {
  readonly name: string;
  readonly query: string;
}

/** The `@custom-media` rules in breakpoints.css, in source order. */
function readCustomMedia(css: string): readonly CustomMedia[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return Array.from(source.matchAll(/@custom-media\s+(--[\w-]+)\s+([^;]+);/g), (match) => ({
    name: match[1] ?? '',
    query: (match[2] ?? '').trim(),
  }));
}

const CUSTOM_MEDIA = readCustomMedia(breakpointsCss);

function BreakpointRow({ breakpoint }: { readonly breakpoint: CustomMedia }) {
  const matches = useMediaQuery(breakpoint.query);
  return (
    <tr>
      <td className={styles['mono']}>{breakpoint.name}</td>
      <td className={styles['mono']}>{breakpoint.query}</td>
      <td>{matches ? 'Yes' : 'No'}</td>
    </tr>
  );
}

function Breakpoints() {
  const layoutSizes = baseTokens('--').filter((token) => /-(width|height|min)$/.test(token.name));
  return (
    <div className={styles['example']}>
      <table className={styles['definitionTable']}>
        <caption className={styles['caption']}>Custom media from breakpoints.css</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Query</th>
            <th scope="col">Matches now</th>
          </tr>
        </thead>
        <tbody>
          {CUSTOM_MEDIA.map((breakpoint) => (
            <BreakpointRow key={breakpoint.name} breakpoint={breakpoint} />
          ))}
        </tbody>
      </table>
      <table className={styles['definitionTable']}>
        <caption className={styles['caption']}>Layout sizes from tokens.css</caption>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {layoutSizes.map((token) => (
            <tr key={token.name}>
              <td className={styles['mono']}>{token.name}</td>
              <td className={styles['mono']}>{token.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-breakpoints',
  title: 'Breakpoints',
  group: 'Tokens',
  notes:
    'One layout breakpoint, --bp-mobile. --bp-wide only caps widths. Resize the window or use ' +
    'the phone frame to watch "Matches now" change.',
  render: () => <Breakpoints />,
};
