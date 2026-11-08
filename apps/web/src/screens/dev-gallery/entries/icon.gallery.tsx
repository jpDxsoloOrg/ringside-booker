import { Icon, ICON_GROUPS } from '@/components/Icon';
import { Cluster, Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function IconSet() {
  return (
    <Stack gap={4}>
      {ICON_GROUPS.map((group) => (
        <div key={group.id}>
          <h3 className={styles['subheading']}>{group.label}</h3>
          <ul className={styles['iconGrid']}>
            {group.names.map((name) => (
              <li key={name} className={styles['iconTile']} data-icon-name={name}>
                <Icon name={name} size="md" decorative />
                <span className={styles['iconName']}>{name}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Cluster gap={4} align="end">
        <Icon name="star" size="sm" label="Small star" />
        <Icon name="star" size="md" label="Medium star" />
        <Icon name="star" size="lg" label="Large star" />
        <span className={styles['caption']}>sm, md and lg, each with a label</span>
      </Cluster>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'icon',
  title: 'Icon',
  group: 'Primitives',
  notes:
    'Every mapped name, drawn from Lucide. Pass decorative when text beside the icon says the same thing; otherwise pass a label.',
  render: () => <IconSet />,
};
