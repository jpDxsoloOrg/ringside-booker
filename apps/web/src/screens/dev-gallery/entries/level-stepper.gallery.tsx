import { useState } from 'react';
import { LevelStepper } from '@/components/LevelStepper';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const TV_REASON = "Can't go below level 3 while your TV deal with Channel 9 runs";

/** Every state of the stepper; the first one moves, as a screen would after its dialog. */
function LevelStepperDemo() {
  const [level, setLevel] = useState(4);
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Default: press − or +</h3>
        <LevelStepper label="Camera" level={level} onRequestChange={setLevel} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>At the TV deal floor: − says why</h3>
        <LevelStepper
          label="Camera"
          level={3}
          min={3}
          minReason={TV_REASON}
          onRequestChange={() => undefined}
        />
        <p className={styles['caption']}>{TV_REASON}</p>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>At the top</h3>
        <LevelStepper label="Pyro" level={10} onRequestChange={() => undefined} />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Held back while a change is saved</h3>
        <LevelStepper
          label="Editing"
          level={6}
          disabled
          disabledReason="Saving a change"
          onRequestChange={() => undefined}
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'level-stepper',
  title: 'LevelStepper',
  group: 'Primitives',
  notes:
    'A 0–10 level between − and + buttons, as on Business > Production. A held-back button stays ' +
    'focusable so its tooltip can say why; the screen also says it in words. 44px buttons on a phone.',
  render: () => <LevelStepperDemo />,
};
