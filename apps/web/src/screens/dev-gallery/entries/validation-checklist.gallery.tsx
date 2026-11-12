import { Stack } from '@/components/layout';
import { ValidationChecklist } from '@/screens/booking/ValidationChecklist';
import type { GalleryEntry } from '../galleryEntry';
import { galleryIssue, galleryValidation } from '../fixtures/booking';
import styles from './entries.module.css';

const WITH_PROBLEMS = galleryValidation(
  2,
  [
    galleryIssue('mainCardFilled', 'error', 'Main card: 2 of 6 slots filled (needs 3)'),
    galleryIssue(
      'results',
      'error',
      'Slot 3: no result planned; pick a winner, a draw or a no contest',
      2,
    ),
    galleryIssue('mainEvent', 'error', 'The main event (Slot 6) is empty', 5),
  ],
  [galleryIssue('available', 'warning', 'Kai Moreno works for Altura Overclock', 0)],
);

const WARNINGS_ONLY = galleryValidation(
  6,
  [],
  [galleryIssue('titles', 'warning', 'The Crown Title belongs to Altura Overclock', 5)],
);

function ValidationChecklistDemo() {
  return (
    <Stack gap={6}>
      <p className={styles['subheading']}>Problems and a warning (Lock stays off)</p>
      <ValidationChecklist
        validation={WITH_PROBLEMS}
        onShowSlot={() => undefined}
        headingLevel={3}
      />
      <p className={styles['subheading']}>Warnings only (Lock is allowed)</p>
      <ValidationChecklist validation={WARNINGS_ONLY} headingLevel={3} />
      <p className={styles['subheading']}>Every check passed</p>
      <ValidationChecklist validation={galleryValidation(6, [])} headingLevel={3} />
      <p className={styles['subheading']}>Still checking</p>
      <ValidationChecklist validation={null} headingLevel={3} />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'validation-checklist',
  title: 'Booking checklist',
  group: 'Office',
  notes:
    'What stands between a card and Lock: each line passed (check), a problem (red, cross) or a warning (amber, triangle), always with words, then every problem with its slot.',
  render: () => <ValidationChecklistDemo />,
};
