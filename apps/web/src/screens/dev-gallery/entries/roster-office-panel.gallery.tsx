import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { TopOfRosterPanel } from '@/screens/roster/officePanel';
import type { GalleryEntry } from '../galleryEntry';
import { galleryPopularityExplanation, galleryTopOfRoster } from '../fixtures/roster';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import styles from './entries.module.css';

function createRosterTraceTransport(): EngineTransport {
  return createTraceFixtureTransport([], undefined, {
    'roster.explain': (args) => {
      const row = galleryTopOfRoster.find((each) => each.employmentId === args.employmentId);
      return row === undefined ? null : galleryPopularityExplanation(row);
    },
  });
}

function TopOfRosterDemo() {
  return (
    <EngineProvider createTransport={createRosterTraceTransport}>
      <Stack gap={5}>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>Five wrestlers</h3>
          <TopOfRosterPanel rows={galleryTopOfRoster} />
        </section>
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>No wrestlers under contract</h3>
          <TopOfRosterPanel rows={[]} />
        </section>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'roster-office-panel',
  title: 'Top of your roster (Office panel)',
  group: 'Office',
  notes:
    "The Office's side panel, fed by roster.summary (topByPopularity): portrait, name linking to " +
    'the profile, push, popularity with a Why? (roster.explain) and momentum, "–" before a ' +
    "wrestler's first appearance. A stand-in engine answers the Why? here.",
  render: () => <TopOfRosterDemo />,
};
