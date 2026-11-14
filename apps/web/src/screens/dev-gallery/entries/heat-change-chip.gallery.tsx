import type { ReactNode } from 'react';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { HeatChangeChip } from '@/components/HeatChangeChip';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import { GALLERY_HEAT_STEP_REF, galleryHeatStepEntry } from '../fixtures/storylineHeat';
import styles from './entries.module.css';

function createTransport(): EngineTransport {
  return createTraceFixtureTransport([galleryHeatStepEntry]);
}

function Example({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      {children}
    </section>
  );
}

function HeatChangeChipDemo() {
  return (
    <EngineProvider createTransport={createTransport}>
      <Stack gap={5}>
        <Example title="Up, with a Why?">
          <HeatChangeChip
            storylineName="Ashfall Rivalry"
            before={54}
            after={62}
            traceRef={GALLERY_HEAT_STEP_REF}
          />
        </Example>
        <Example title="Down">
          <HeatChangeChip
            storylineName="Harbour Grudge"
            before={41}
            after={35}
            traceRef={GALLERY_HEAT_STEP_REF}
          />
        </Example>
        <Example title="Unchanged">
          <HeatChangeChip
            storylineName="Quiet Feud"
            before={54}
            after={54}
            traceRef={GALLERY_HEAT_STEP_REF}
          />
        </Example>
        <Example title="The finale">
          <HeatChangeChip
            storylineName="Ashfall Rivalry"
            before={78}
            after={88}
            traceRef={GALLERY_HEAT_STEP_REF}
            finale
          />
        </Example>
        <Example title="No trace kept">
          <HeatChangeChip
            storylineName="A storyline with a much longer name than most"
            before={30}
            after={36}
            traceRef={null}
          />
        </Example>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'heat-change-chip',
  title: 'HeatChangeChip',
  group: 'Broadcast',
  notes:
    'How one linked segment moved a storyline: name, heat before → after (whole points), the ' +
    'change and a Why? on the new heat. "(no change)" when it stayed put; a Finale badge on the ' +
    "story's finale. With no kept trace there is no button.",
  render: () => <HeatChangeChipDemo />,
};
