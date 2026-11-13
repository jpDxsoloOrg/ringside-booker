import type { ShowPopularityChangeView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { formatPopularityChange, isFlatChange } from '@/components/PopularityChangeList';
import type { ResultsSectionProps } from '@/screens/show-results/resultsSectionRegistry';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import type { ShowReportLineContent } from '@/screens/show-results/showReportLineRegistry';

/** The section the line links to: EVT5's "Popularity" results section. */
const POPULARITY_SECTION = 'evt5.popularity';

function regions(count: number): string {
  return `${String(count)} ${count === 1 ? 'region' : 'regions'}`;
}

/**
 * EVT5's line in the show report: "Gained fans in 9 regions, lost them in 2; most in Texas
 * (+0.42)". Null unless the show changed the promotion's popularity.
 */
export function popularityReportLine(data: ShowPopularityChangeView): ShowReportLineContent | null {
  const { summary } = data;
  if (data.status !== 'applied' || summary === null) return null;
  const parts: string[] = [];
  if (summary.regionsGained > 0) parts.push(`Gained fans in ${regions(summary.regionsGained)}`);
  if (summary.regionsLost > 0) {
    parts.push(
      `${parts.length === 0 ? 'Lost fans in' : 'lost them in'} ${regions(summary.regionsLost)}`,
    );
  }
  if (parts.length === 0)
    return { label: 'Fans', text: 'About the same everywhere', tone: 'neutral' };
  const biggest = data.countries
    .flatMap((country) => country.regions)
    .reduce<ShowPopularityChangeView['countries'][number]['regions'][number] | null>(
      (best, region) =>
        best === null || Math.abs(region.change) > Math.abs(best.change) ? region : best,
      null,
    );
  const most =
    biggest === null || isFlatChange(biggest.change)
      ? ''
      : `; most in ${biggest.name} (${formatPopularityChange(biggest.change)})`;
  const world = summary.world.change;
  return {
    label: 'Fans',
    text: `${parts.join(', ')}${most}`,
    tone: isFlatChange(world) ? 'neutral' : world > 0 ? 'positive' : 'negative',
    targetId: resultsSectionAnchor(POPULARITY_SECTION),
  };
}

/** The line as the report asks for it: a hook reading `popularity.showChange`. */
export function usePopularityReportLine({
  eventInstanceId,
}: ResultsSectionProps): ShowReportLineContent | null {
  const query = useEngineQuery('popularity.showChange', { eventInstanceId });
  return query.data === undefined ? null : popularityReportLine(query.data);
}
