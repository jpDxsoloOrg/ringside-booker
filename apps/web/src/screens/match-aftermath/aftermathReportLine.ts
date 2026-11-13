import type { AftermathResult } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { isFlatChange } from '@/components/PopularityChangeList';
import type { ResultsSectionProps } from '@/screens/show-results/resultsSectionRegistry';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import type { ShowReportLineContent } from '@/screens/show-results/showReportLineRegistry';

/** The section the line links to: MTCH3's "Popularity & momentum" results section. */
const AFTERMATH_SECTION = 'mtch3.aftermath';

/**
 * MTCH3's line in the show report: how many workers' popularity went up and down in the show's
 * region ("4 up, 2 down, 1 the same"), each worker counted once over the whole show. Null when no
 * match on the show changed anyone.
 */
export function aftermathReportLine(data: AftermathResult): ShowReportLineContent | null {
  const byPerson = new Map<string, number>();
  for (const segment of data.segments) {
    for (const worker of segment.workers) {
      // The show region comes first, so this is the change where the show was held.
      const change = worker.popularity.regions[0]?.change ?? 0;
      byPerson.set(worker.personId, (byPerson.get(worker.personId) ?? 0) + change);
    }
  }
  if (byPerson.size === 0) return null;
  let up = 0;
  let down = 0;
  let same = 0;
  for (const change of byPerson.values()) {
    if (isFlatChange(change)) same += 1;
    else if (change > 0) up += 1;
    else down += 1;
  }
  const parts = [`${String(up)} up`, `${String(down)} down`];
  if (same > 0) parts.push(`${String(same)} the same`);
  return {
    label: 'Popularity',
    text: parts.join(', '),
    tone: 'neutral',
    targetId: resultsSectionAnchor(AFTERMATH_SECTION),
  };
}

/** The line as the report asks for it: a hook reading `match.aftermath`. */
export function useAftermathReportLine({
  eventInstanceId,
}: ResultsSectionProps): ShowReportLineContent | null {
  const query = useEngineQuery('match.aftermath', { eventInstanceId });
  return query.data === undefined ? null : aftermathReportLine(query.data);
}
