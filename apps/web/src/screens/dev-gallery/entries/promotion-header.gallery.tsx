import { parseId } from '@ringside/engine';
import type { PromotionProfile } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { PromotionHeader } from '@/screens/promotions/profile/PromotionHeader';
import type { GalleryEntry } from '../galleryEntry';
import { galleryOwnHeader, galleryRivalHeader } from '../fixtures/rivalDesk';
import styles from './entries.module.css';

interface HeaderExample {
  readonly caption: string;
  readonly id: string;
  readonly header: PromotionProfile['header'];
}

const EXAMPLES: readonly HeaderExample[] = [
  {
    caption: 'A computer-run promotion with two brands',
    id: 'pro_0000000101',
    header: galleryRivalHeader,
  },
  {
    caption: 'Your own promotion: a long name wraps, no brands',
    id: 'pro_0000000102',
    header: galleryOwnHeader,
  },
];

function PromotionHeaderDemo() {
  return (
    <Stack gap={5}>
      {EXAMPLES.map((example) => (
        <section key={example.id} className={styles['example']}>
          <p className={styles['caption']}>{example.caption}</p>
          <PromotionHeader
            promotionId={parseId('promotion', example.id)}
            header={example.header}
            heading="section"
          />
        </section>
      ))}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'promotion-header',
  title: 'Promotion header',
  group: 'Office',
  notes:
    'The top of a promotion profile: large crest, name, short name, who runs it, then style, home, founding year and brands (two columns on a phone). On the profile the name is the page heading; here it is a section heading.',
  render: () => <PromotionHeaderDemo />,
};
