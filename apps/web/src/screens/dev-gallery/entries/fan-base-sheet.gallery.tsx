import { useId, useState } from 'react';
import type { PromotionId } from '@ringside/engine';
import { FanBaseSheet } from '@/app/AppShell/status/FanBaseSheet';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import {
  createFanBaseTransport,
  LOCAL_PROMOTION_ID,
  localFanBase,
  nationalFanBase,
} from '../fixtures/fanBase';
import styles from './entries.module.css';

interface ExampleProps {
  readonly heading: string;
  readonly caption: string;
  readonly promotionId?: PromotionId;
  readonly buttonLabel: string;
}

/** One opener and its own sheet: a gallery entry may show several, a screen keeps one. */
function Example({ heading, caption, promotionId, buttonLabel }: ExampleProps) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={headingId} className={styles['example']}>
      <h3 id={headingId} className={styles['subheading']}>
        {heading}
      </h3>
      <p className={styles['caption']}>{caption}</p>
      <Button
        iconStart="map"
        onClick={() => {
          setOpen(true);
        }}
      >
        {buttonLabel}
      </Button>
      <FanBaseSheet
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        {...(promotionId === undefined ? {} : { promotionId })}
      />
    </section>
  );
}

function FanBaseSheetDemo() {
  return (
    <EngineProvider createTransport={() => createFanBaseTransport()}>
      <Stack gap={6}>
        <Example
          heading="Your national promotion"
          caption={`${nationalFanBase.view.name}: fans in three countries, opened on North America. Seven weekly records draw the trend with the change since last week; the headline's Why? replaces the sheet until it closes.`}
          buttonLabel="Open your fan base"
        />
        <Example
          heading="A local rival"
          caption={`${localFanBase.view.name}: known in one region of one country, so the other places sit behind the toggle. No weekly records yet, so there is no trend.`}
          promotionId={LOCAL_PROMOTION_ID}
          buttonLabel="Open the rival's fan base"
        />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'fan-base-sheet',
  title: 'FanBaseSheet',
  group: 'Overlays',
  notes:
    'Where the fans live: the headline popularity with its Why?, the scope in words, the last weeks as a sparkline and the drill-down from continents to regions, opened on the home continent. A side sheet on desktop, a bottom sheet on a phone. Answers come from a stand-in engine.',
  render: () => <FanBaseSheetDemo />,
};
