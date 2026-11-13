import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { InjuryBanner } from '@/components/InjuryBanner';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import { GALLERY_INJURIES, injuryBannerTraces } from '../fixtures/injuryBanner';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function createInjuryTraceTransport(): EngineTransport {
  return createTraceFixtureTransport(injuryBannerTraces());
}

function InjuryBannerDemo() {
  const [first] = GALLERY_INJURIES;
  return (
    <EngineProvider createTransport={createInjuryTraceTransport}>
      <Stack gap={5}>
        {GALLERY_INJURIES.map(({ title, props }) => (
          <section key={title} className={styles['example']}>
            <h3 className={styles['subheading']}>{title}</h3>
            <div className={broadcast['stage']}>
              <InjuryBanner {...props} />
            </div>
          </section>
        ))}
        {first !== undefined && (
          <section className={styles['example']}>
            <h3 className={styles['subheading']}>Phone width (390px)</h3>
            <div className={broadcast['stage']}>
              <div className={broadcast['phoneColumn']}>
                <InjuryBanner {...first.props} />
              </div>
            </div>
          </section>
        )}
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'injury-banner',
  title: 'InjuryBanner',
  group: 'Broadcast',
  notes:
    'A worker hurt in a match (MTCH4-06), on the results card of that match: the Injured kicker, the name, the injury and the body part, "Out about N weeks" with the injury\'s Why?, and the match\'s injury chance with its Why?. The danger stripe only repeats the word. It slides in once, unless motion is reduced. A stand-in engine answers the Why?s with small sample traces.',
  render: () => <InjuryBannerDemo />,
};
