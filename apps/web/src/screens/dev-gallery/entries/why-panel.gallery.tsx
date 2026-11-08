import { useId } from 'react';
import type { ReactNode } from 'react';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { Explained } from '@/components/Trace';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import {
  attendanceTrace,
  matchRatingTrace,
  OLDER_ATTENDANCE_REF,
  RECENT_ATTENDANCE_REF,
  recentAttendanceEntry,
  summarisedAttendance,
} from '../fixtures/traces';
import styles from './entries.module.css';

function createGalleryTraceTransport(): EngineTransport {
  return createTraceFixtureTransport([recentAttendanceEntry, summarisedAttendance]);
}

function ExampleRow({ name, children }: { readonly name: string; readonly children: ReactNode }) {
  return (
    <div className={styles['explainedCard']}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function WhyPanelSample() {
  const inlineHeadingId = useId();
  const fetchedHeadingId = useId();
  return (
    <Stack gap={6}>
      <section aria-labelledby={inlineHeadingId} className={styles['example']}>
        <h3 id={inlineHeadingId} className={styles['subheading']}>
          Trace passed inline
        </h3>
        <dl className={styles['explainedList']}>
          <ExampleRow name="Attendance">
            <Explained value={9000} label="Attendance" unit="people" trace={attendanceTrace} />
          </ExampleRow>
          <ExampleRow name="Match rating">
            <Explained value={71} label="Match rating" unit="points" trace={matchRatingTrace} />
          </ExampleRow>
          <ExampleRow name="No trace (no button)">
            <Explained value={1250} label="Merchandise sold" unit="count" />
          </ExampleRow>
        </dl>
      </section>
      <section aria-labelledby={fetchedHeadingId} className={styles['example']}>
        <h3 id={fetchedHeadingId} className={styles['subheading']}>
          Fetched by reference
        </h3>
        <p className={styles['caption']}>
          A stand-in engine answers trace.get after a short pause. The older result has been
          summarised, so its panel says only the full breakdowns of recent results are kept.
        </p>
        <EngineProvider createTransport={createGalleryTraceTransport}>
          <dl className={styles['explainedList']}>
            <ExampleRow name="Recent attendance">
              <Explained
                value={9000}
                label="Recent attendance"
                unit="people"
                traceRef={RECENT_ATTENDANCE_REF}
              />
            </ExampleRow>
            <ExampleRow name="Older attendance">
              <Explained
                value={6400}
                label="Older attendance"
                unit="people"
                traceRef={OLDER_ATTENDANCE_REF}
              />
            </ExampleRow>
          </dl>
        </EngineProvider>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'why-panel',
  title: 'Why? panel',
  group: 'Overlays',
  notes:
    'Explained numbers with their Why? buttons. The panel opens on the right on desktop and as a ' +
    'bottom sheet on phones. Checks that changed nothing are hidden behind a toggle, and the ' +
    'footer copies the breakdown as text. Arrow keys move through the steps.',
  render: () => <WhyPanelSample />,
};
