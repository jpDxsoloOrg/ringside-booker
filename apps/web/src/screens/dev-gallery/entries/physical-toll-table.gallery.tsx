import { useState } from 'react';
import type { PersonId, PhysicalPreviewWorker } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { PhysicalTollSummary, PhysicalTollTable } from '@/components/PhysicalTollTable';
import { freshAndExhausted, injuredAndOverLimit, runManySummary } from '../fixtures/physicalToll';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

/** The what-if Select changes the row in place, as the lab would after its re-run. */
function WhatIfExample() {
  const [workers, setWorkers] = useState<readonly PhysicalPreviewWorker[]>(freshAndExhausted);
  const onFatigueChange = (personId: PersonId, fatigue: number | null): void => {
    setWorkers((rows) =>
      rows.map((row) =>
        row.personId === personId
          ? {
              ...row,
              fatigueBefore: fatigue ?? row.fatigueNow,
              fatigueWhatIf: fatigue !== null,
              fatigueAfter: Math.min(100, (fatigue ?? row.fatigueNow) + row.fatigueGain.value),
            }
          : row,
      ),
    );
  };
  return <PhysicalTollTable workers={workers} onFatigueChange={onFatigueChange} />;
}

function PhysicalTollTableDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A fresh worker and an exhausted one (what-if)</h3>
        <WhatIfExample />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>
          Injured, and hurt past the limit; a learner limited by potential
        </h3>
        <PhysicalTollTable workers={injuredAndOverLimit()} caption="Injured rows" />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Run x100 summary</h3>
        <PhysicalTollSummary summary={runManySummary()} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Before a batch</h3>
        <PhysicalTollSummary summary={null} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'physical-toll-table',
  title: 'PhysicalTollTable',
  group: 'Data',
  notes:
    "The Match lab's Physical panel (MTCH4-05): fatigue going in (a what-if Select), fatigue gain, fatigue after, wear with each body part in a popover, learning and the injury chance, each with a Why?, and whether this run hurt the worker. On a phone each worker is a card: the name, the injury chance, and the rest under Physical. Below, the Run x100 summary. Hand-made rows with small stand-in traces.",
  render: () => <PhysicalTollTableDemo />,
};
