import { useState } from 'react';
import { CARD_FULL_MESSAGE } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { AutoFillView } from '@/screens/booking/panels/AutoFillPanel';
import { AutoFillReasonsSheet } from '@/screens/booking/panels/AutoFillReasonsSheet';
import type { GalleryEntry } from '../galleryEntry';
import { galleryAutoFillResult, galleryTraceOf } from '../fixtures/rivalShowCards';
import styles from './entries.module.css';

function AutoFillPanelDemo() {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Ready, with open slots</h3>
        <AutoFillView fillBlock={null} rebookBlock={null} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Filling</h3>
        <AutoFillView fillBlock={null} rebookBlock={null} pending="fill" />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Every slot taken</h3>
        <AutoFillView fillBlock={CARD_FULL_MESSAGE} rebookBlock={null} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A card that can no longer change</h3>
        <AutoFillView
          fillBlock="This show has already run"
          rebookBlock="This show has already run"
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Refused by the engine</h3>
        <AutoFillView
          fillBlock={null}
          rebookBlock={null}
          refusal="Only the person running Coastal Live can book this show"
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>The reasons sheet</h3>
        <p className={styles['caption']}>
          Opens after a press: what was filled and why, the slot left open, and a reminder that the
          winners are still to pick.
        </p>
        <div>
          <Button
            onClick={() => {
              setSheetOpen(true);
            }}
          >
            Open the reasons sheet
          </Button>
        </div>
        <AutoFillReasonsSheet
          open={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
          }}
          result={galleryAutoFillResult}
          traceOf={galleryTraceOf}
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'auto-fill-panel',
  title: 'Auto-fill panel',
  group: 'Office',
  notes:
    'The booking screen’s side panel that lends the player the computer booker for open slots, or for the whole card after a confirmation. It never picks a winner. Disabled with the engine’s reason when the card cannot change or is full.',
  render: () => <AutoFillPanelDemo />,
};
