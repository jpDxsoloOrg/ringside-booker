import { Badge, CountBadge } from '@/components/Badge';
import { Cluster, Stack } from '@/components/layout';
import { LEGACY_TONE_ROLES, LEGACY_TONES, ROLE_TONES } from '@/components/tone';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

function BadgeDemo() {
  return (
    <Stack gap={4}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Soft</h3>
        <Cluster gap={2}>
          {ROLE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Solid</h3>
        <Cluster gap={2}>
          {ROLE_TONES.map((tone) => (
            <Badge key={tone} tone={tone} variant="solid">
              {tone}
            </Badge>
          ))}
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Older tone names</h3>
        <p className={styles['caption']}>
          Kept so existing screens still work; each draws as its role.
        </p>
        <Cluster gap={2}>
          {LEGACY_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone} = {LEGACY_TONE_ROLES[tone]}
            </Badge>
          ))}
        </Cluster>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>CountBadge</h3>
        <Cluster gap={6}>
          <Cluster gap={2}>
            <span className={styles['caption']}>0:</span>
            <CountBadge count={0} label="0 unread" />
            <span className={styles['caption']}>(hidden)</span>
          </Cluster>
          <Cluster gap={2}>
            <span className={styles['caption']}>0 with showZero:</span>
            <CountBadge count={0} showZero tone="neutral" label="0 unread" />
          </Cluster>
          <Cluster gap={2}>
            <span className={styles['caption']}>3:</span>
            <CountBadge count={3} label="3 unread" />
          </Cluster>
          <Cluster gap={2}>
            <span className={styles['caption']}>150:</span>
            <CountBadge count={150} label="150 unread" />
          </Cluster>
        </Cluster>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'badge',
  title: 'Badge',
  group: 'Primitives',
  notes:
    'Every colour role, soft and solid: data cyan, action red-orange, prestige gold, positive and negative deltas. Plus CountBadge.',
  render: () => <BadgeDemo />,
};
