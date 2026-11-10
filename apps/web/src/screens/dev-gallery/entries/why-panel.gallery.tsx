import { useId } from 'react';
import type { ReactNode } from 'react';
import { parseId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { Explained, LazyWhyButton } from '@/components/Trace';
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

/** Stands in for a list row's person; the stand-in engine answers for anyone. */
const SAMPLE_PERSON_ID = parseId('person', 'per_0000000001');
const SAMPLE_OVERALL = 71;

function createGalleryTraceTransport(): EngineTransport {
  return createTraceFixtureTransport([recentAttendanceEntry, summarisedAttendance], undefined, {
    'workers.explain': () => ({ value: SAMPLE_OVERALL, trace: matchRatingTrace }),
  });
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
  const lazyHeadingId = useId();
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
      <section aria-labelledby={lazyHeadingId} className={styles['example']}>
        <h3 id={lazyHeadingId} className={styles['subheading']}>
          Built when opened
        </h3>
        <p className={styles['caption']}>
          LazyWhyButton, for list rows that carry numbers only. Nothing is asked of the engine until
          the panel opens; the stand-in then answers workers.explain after a short pause.
        </p>
        <EngineProvider createTransport={createGalleryTraceTransport}>
          <dl className={styles['explainedList']}>
            <ExampleRow name="Overall in a list row">
              <span className="tabular">{SAMPLE_OVERALL}</span>{' '}
              <LazyWhyButton
                label="Overall"
                value={SAMPLE_OVERALL}
                unit="points"
                queryName="workers.explain"
                args={{ personId: SAMPLE_PERSON_ID, metric: 'overall' }}
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
    'footer copies the breakdown as text. Arrow keys move through the steps. LazyWhyButton is ' +
    'the same button for a number whose breakdown is only built when the panel opens.',
  render: () => <WhyPanelSample />,
};
