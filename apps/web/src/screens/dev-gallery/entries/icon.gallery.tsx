import { Icon, ICON_NAMES } from '@/components/Icon';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function IconSet() {
  return (
    <Stack gap={4}>
      <ul className={styles['iconGrid']}>
        {ICON_NAMES.map((name) => (
          <li key={name} className={styles['iconTile']}>
            <Icon name={name} size="md" />
            {name}
          </li>
        ))}
      </ul>
      <Cluster gap={4} align="end">
        <Icon name="star" size="sm" title="Small star" />
        <Icon name="star" size="md" title="Medium star" />
        <Icon name="star" size="lg" title="Large star" />
        <span className={styles['caption']}>sm, md and lg, each with a title</span>
      </Cluster>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'icon',
  title: 'Icon',
  group: 'Primitives',
  render: () => <IconSet />,
};
