import { useId } from 'react';
import type { ReactNode } from 'react';
import { StatusChips } from '@/app/AppShell/status/StatusChips';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import { createFanBaseTransport, fanBaseStatus } from '../fixtures/fanBase';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

interface ExampleProps {
  readonly heading: string;
  readonly caption: string;
  readonly withHeadline: boolean;
  readonly narrow?: boolean;
  readonly children: ReactNode;
}

function Example({ heading, caption, withHeadline, narrow = false, children }: ExampleProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles['example']}>
      <h3 id={headingId} className={styles['subheading']}>
        {heading}
      </h3>
      <p className={styles['caption']}>{caption}</p>
      <EngineProvider createTransport={() => createFanBaseTransport(withHeadline)}>
        <div className={narrow ? broadcast['phoneColumn'] : undefined}>{children}</div>
      </EngineProvider>
    </section>
  );
}

function PopularityChipDemo() {
  return (
    <Stack gap={6}>
      <Example
        heading="Top bar, with a headline"
        caption="The home country's popularity with its Why?, and the map button that opens the Fan base sheet."
        withHeadline
      >
        <StatusChips status={fanBaseStatus(true)} placement="bar" />
      </Example>
      <Example
        heading="Phone status sheet, with a headline"
        caption="A full-width Fan base button under prestige. In the app the status sheet closes first, then the Fan base sheet opens."
        withHeadline
        narrow
      >
        <StatusChips status={fanBaseStatus(true)} placement="sheet" />
      </Example>
      <Example
        heading="Top bar, before the first weekly report"
        caption="A world made before DAY2 has no headline until its first Monday: the home region's value with the Why? built on the spot, and no Fan base button."
        withHeadline={false}
      >
        <StatusChips status={fanBaseStatus(false)} placement="bar" />
      </Example>
      <Example
        heading="Phone status sheet, before the first weekly report"
        caption="The same fallback in the sheet."
        withHeadline={false}
        narrow
      >
        <StatusChips status={fanBaseStatus(false)} placement="sheet" />
      </Example>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'popularity-chip',
  title: 'Popularity chip',
  group: 'Office',
  notes:
    "The top bar's popularity: the headline figure (office.popularity.headlineScope) with its stored Why?, prestige under it, and the Fan base button; in the bar and in the phone's status sheet, with and without a headline.",
  render: () => <PopularityChipDemo />,
};
