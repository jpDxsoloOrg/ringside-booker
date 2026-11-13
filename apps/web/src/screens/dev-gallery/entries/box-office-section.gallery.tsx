import { Stack } from '@/components/layout';
import { BoxOfficeKpis } from '@/screens/box-office/BoxOfficeSection';
import type { BoxOfficeKpisProps } from '@/screens/box-office/BoxOfficeSection';
import {
  galleryLossBoxOffice,
  galleryOwnBoxOffice,
  galleryRivalBoxOffice,
  gallerySoldOutBoxOffice,
} from '../fixtures/boxOffice';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function Example({
  title,
  data,
  narrow = false,
}: {
  readonly title: string;
  readonly data: BoxOfficeKpisProps;
  readonly narrow?: boolean;
}) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={narrow ? broadcast['phoneColumn'] : undefined}>
        <BoxOfficeKpis {...data} />
      </div>
    </section>
  );
}

function BoxOfficeDemo() {
  return (
    <Stack gap={5}>
      <Example title="Your show" data={galleryOwnBoxOffice} />
      <Example title="A rival's show: the crowd only" data={galleryRivalBoxOffice} />
      <Example title="Sold out" data={gallerySoldOutBoxOffice} />
      <Example title="Loss-making: a stadium too big for the crowd" data={galleryLossBoxOffice} />
      <Example title="Phone width (390px)" data={galleryOwnBoxOffice} narrow />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'box-office-section',
  title: 'Box office section',
  group: 'Data',
  notes:
    "The results page's Box office section (EVT6-05), from the engine's show-day formulas run on " +
    "invented inputs (no engine). The player's own shows show Attendance, Gate, Venue rent, Live " +
    "merch and Net; a rival's shows its attendance only. Every Why? opens the real breakdown.",
  render: () => <BoxOfficeDemo />,
};
