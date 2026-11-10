import { Panel } from '@/components/Panel';
import { PopularityDrilldown } from '@/components/PopularityDrilldown';
import type { ProfileTabContext } from '../profileTabs';

/**
 * Popularity from the world down, opened at the continent they are best known in. Every figure
 * above a region has its own Why?.
 */
export function PopularityTab({ profile }: ProfileTabContext) {
  const { popularity, header } = profile;
  const subtitle =
    popularity.top === null
      ? 'Not known anywhere yet.'
      : `Best known in ${popularity.top.countryName}.`;

  return (
    <Panel title="Popularity" subtitle={subtitle} headingLevel={2}>
      <PopularityDrilldown
        rollup={popularity}
        subjectName={header.ringName}
        initiallyOpen={popularity.topContinentId === null ? [] : [popularity.topContinentId]}
      />
    </Panel>
  );
}
