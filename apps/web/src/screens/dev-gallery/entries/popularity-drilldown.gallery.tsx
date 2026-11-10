import { useId } from 'react';
import type { PopularityRollupView } from '@ringside/engine';
import { Stack } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { PopularityDrilldown } from '@/components/PopularityDrilldown';
import type { GalleryEntry } from '../galleryEntry';
import {
  firstContinentId,
  GLOBAL_STAR_NAME,
  globalStarRollup,
  LOCAL_HERO_NAME,
  localHeroRollup,
  UNKNOWN_ROOKIE_NAME,
  unknownRookieRollup,
} from '../fixtures/popularityRollups';
import styles from './entries.module.css';

interface SubjectExampleProps {
  readonly heading: string;
  readonly caption: string;
  readonly subjectName: string;
  readonly rollup: PopularityRollupView;
  readonly openFirst?: boolean;
}

function SubjectExample({
  heading,
  caption,
  subjectName,
  rollup,
  openFirst = false,
}: SubjectExampleProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles['example']}>
      <h3 id={headingId} className={styles['subheading']}>
        {heading}
      </h3>
      <p className={styles['caption']}>{caption}</p>
      <Panel title={`${subjectName}: popularity`} headingLevel={4}>
        <PopularityDrilldown
          rollup={rollup}
          subjectName={subjectName}
          {...(openFirst ? { initiallyOpen: firstContinentId(rollup) } : {})}
        />
      </Panel>
    </section>
  );
}

function PopularityDrilldownDemo() {
  return (
    <Stack gap={6}>
      <SubjectExample
        heading="Local hero"
        caption="Known in two regions of one country. The other continents and countries sit behind the toggle."
        subjectName={LOCAL_HERO_NAME}
        rollup={localHeroRollup}
        openFirst
      />
      <SubjectExample
        heading="Global star"
        caption="Fans on every continent, so nothing is hidden and there is no toggle."
        subjectName={GLOBAL_STAR_NAME}
        rollup={globalStarRollup}
      />
      <SubjectExample
        heading="No fans yet"
        caption="Every level is 0. The list is empty until the toggle brings the places back."
        subjectName={UNKNOWN_ROOKIE_NAME}
        rollup={unknownRookieRollup}
      />
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'popularity-drilldown',
  title: 'PopularityDrilldown',
  group: 'Data',
  notes:
    'Popularity from the world down. A continent opens into its countries and a country into its ' +
    'regions. Country, continent and world figures are worked out from the regions, weighted by ' +
    'population, and each has a Why?; region values are stored, so they have none. On phones the ' +
    'bar drops under the name.',
  render: () => <PopularityDrilldownDemo />,
};
