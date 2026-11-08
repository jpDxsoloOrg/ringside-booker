import { classNames } from '@/components/classNames';
import type { GalleryEntry } from '../galleryEntry';
import { baseTokens } from '../tokenCatalog';
import styles from './entries.module.css';

function ShadowScale() {
  return (
    <ul className={styles['shadowGrid']}>
      {baseTokens('--shadow-').map((token) => (
        <li
          key={token.name}
          className={classNames(styles['shadowCard'], styles[token.name.slice(2)])}
        >
          <span className={styles['mono']}>{token.name}</span>
          <span className={styles['caption']}>{token.value}</span>
        </li>
      ))}
    </ul>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'tokens-shadows',
  title: 'Shadows',
  group: 'Tokens',
  notes: 'Elevation for panels (1), menus (2) and dialogs (3). Panels drop theirs on phones.',
  render: () => <ShadowScale />,
};
