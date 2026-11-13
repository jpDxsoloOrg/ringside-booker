/**
 * MTCH4's "Injured" banners on the results page (MTCH4-06): for one segment result card, a banner
 * for each worker WRK6 recorded as hurt in that match, from `match.segmentInjuries` for the show.
 * Every card on the page asks with the same arguments, so the query cache answers them all from
 * one request. Nothing shows while it loads or when the engine refuses.
 */
import type { SegmentInjuryView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { InjuryBanner } from '@/components/InjuryBanner';
import { WorkerLink } from '@/components/WorkerLink';
import type { ResultsCardBannerProps } from '@/screens/show-results/resultsCardBannerRegistry';

export interface SegmentInjuryBannersProps {
  /** The show's injuries, from `match.segmentInjuries`. */
  readonly injuries: readonly SegmentInjuryView[];
  /** The card's segment: only its injuries are drawn. */
  readonly segmentId: string;
}

/** The banners of one segment, drawn from the show's injuries with no engine of their own. */
export function SegmentInjuryBanners({ injuries, segmentId }: SegmentInjuryBannersProps) {
  const mine = injuries.filter((injury) => injury.segmentId === segmentId);
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((injury) => (
        <InjuryBanner
          key={injury.injuryId}
          name={injury.name}
          bodyPart={injury.bodyPart}
          kindLabel={injury.kindLabel}
          weeksOut={injury.weeksOut}
          chance={injury.chance}
          chanceTraceRef={injury.chanceTraceRef}
          injuryTraceRef={injury.injuryTraceRef}
          renderName={(name) => <WorkerLink personId={injury.personId} name={name} />}
        />
      ))}
    </>
  );
}

/** The registered card banner: matches only, everything else has no physical toll. */
export function InjuryCardBanner({ eventInstanceId, segment }: ResultsCardBannerProps) {
  const query = useEngineQuery(
    'match.segmentInjuries',
    { eventInstanceId },
    { enabled: segment.kind === 'match' },
  );
  if (segment.kind !== 'match' || query.data === undefined) return null;
  return <SegmentInjuryBanners injuries={query.data.injuries} segmentId={segment.segmentId} />;
}
