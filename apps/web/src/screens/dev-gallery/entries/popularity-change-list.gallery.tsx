import type { ReactNode } from 'react';
import type { ShowPopularityChangeView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { PopularityChangeList } from '@/components/PopularityChangeList';
import { PopularitySection } from '@/screens/promotion-popularity/PopularitySection';
import type { GalleryEntry } from '../galleryEntry';
import {
  bigTelevisedShowChange,
  showChangeFixtures,
  showChangeTraceEntries,
  showChangeWithStatus,
  smallUntelevisedShowChange,
  weakShowChange,
  worldwideShowChange,
} from '../fixtures/popularityShowChange';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

const fixtures = showChangeFixtures();

/** Answers the regions' Why? panels and `popularity.showChange` from the fixtures. */
function createPopularityTransport(): EngineTransport {
  return createTraceFixtureTransport(showChangeTraceEntries(), undefined, {
    'popularity.showChange': (args) =>
      fixtures.get(args.eventInstanceId) ?? showChangeWithStatus('notApplied'),
  });
}

interface ExampleProps {
  readonly title: string;
  readonly caption: string;
  readonly children: ReactNode;
  readonly narrow?: boolean;
}

/** One labelled example inside a results-style panel headed "Popularity". */
function Example({ title, caption, children, narrow = false }: ExampleProps) {
  return (
    <section className={styles['example']} aria-label={title}>
      <h3 className={styles['subheading']}>{title}</h3>
      <p className={styles['caption']}>{caption}</p>
      <div className={narrow ? broadcast['phoneColumn'] : undefined}>
        <Panel title="Popularity" headingLevel={4} variant="broadcast">
          {children}
        </Panel>
      </div>
    </section>
  );
}

function ListExample({
  title,
  caption,
  data,
}: {
  readonly title: string;
  readonly caption: string;
  readonly data: ShowPopularityChangeView;
}) {
  return (
    <Example title={title} caption={caption}>
      <PopularityChangeList data={data} />
    </Example>
  );
}

function PopularityChangeListDemo() {
  return (
    <EngineProvider createTransport={createPopularityTransport}>
      <Stack gap={6}>
        <ListExample
          title="A big company's televised show"
          caption="17 regions over two countries: small gains, one loss and five about the same. Regions on the national TV deal read 'TV: National Signal Network'."
          data={bigTelevisedShowChange}
        />
        <ListExample
          title="A small company's untelevised show"
          caption="Six regions around the show region, larger gains. Ontario hit the monthly gain cap; Quebec's full breakdown is no longer kept, so its Why? shows the summary."
          data={smallUntelevisedShowChange}
        />
        <ListExample
          title="A rival's weak show"
          caption="The score fell short of what fans expected almost everywhere, so most regions lost fans."
          data={weakShowChange}
        />
        <ListExample
          title="A worldwide pay-per-view"
          caption="40 regions in 8 countries. Countries past the third start folded so the list stays short."
          data={worldwideShowChange}
        />
        <Example
          title="Phone width (390px)"
          caption="The five biggest changes as cards, then Show all (17) for the grouped list."
          narrow
        >
          <PopularityChangeList data={bigTelevisedShowChange} layout="cards" />
        </Example>
        <Example
          title="The section, loading from the engine"
          caption="The results page's section: quiet blocks while the answer loads, then the list."
        >
          <PopularitySection eventInstanceId={smallUntelevisedShowChange.eventInstanceId} />
        </Example>
        <Example title="Not run yet" caption="The show is still to come.">
          <PopularitySection
            eventInstanceId={showChangeWithStatus('notCompleted').eventInstanceId}
          />
        </Example>
        <Example
          title="Too old"
          caption="Four weeks after the show, only its worldwide change is kept."
        >
          <PopularitySection eventInstanceId={showChangeWithStatus('pruned').eventInstanceId} />
        </Example>
        <Example
          title="No change stored"
          caption="The show ran but changed nobody's popularity, for example because its promotion had closed."
        >
          <PopularitySection eventInstanceId={showChangeWithStatus('notApplied').eventInstanceId} />
        </Example>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'popularity-change-list',
  title: 'PopularityChangeList',
  group: 'Data',
  notes:
    "What one show did to its promotion's popularity (EVT5-03), the results page's Popularity section: a summary of regions gained, lost and about the same with the worldwide change and its Why?, then every reached region under its country with how the show reached it, what fans expected against the score, before → after and the change with its Why?. Capped regions and changes inside the dead zone are said in words. Made-up shows; every number is invented.",
  render: () => <PopularityChangeListDemo />,
};
