import type { ReactNode } from 'react';
import { compareDates } from '@ringside/engine';
import { useCalendarDayMarkerSources } from './registry';
import type {
  CalendarDayMarker,
  CalendarDayMarkerRange,
  CalendarDayMarkersDefinition,
} from './registry';

interface MarkerSourceProps {
  readonly source: CalendarDayMarkersDefinition;
  readonly rest: readonly CalendarDayMarkersDefinition[];
  readonly range: CalendarDayMarkerRange;
  readonly collected: readonly CalendarDayMarker[];
  readonly children: (markers: readonly CalendarDayMarker[]) => ReactNode;
}

function inRange(marker: CalendarDayMarker, range: CalendarDayMarkerRange): boolean {
  return compareDates(marker.date, range.from) >= 0 && compareDates(marker.date, range.to) <= 0;
}

/**
 * Calls one source's hook, then hands on to the next source. Each source gets a component of its
 * own, so its hook always runs in the same place however many sources are registered.
 */
function MarkerSource({ source, rest, range, collected, children }: MarkerSourceProps) {
  const markers = source.useMarkers(range).filter((marker) => inRange(marker, range));
  return (
    <MarkerChain sources={rest} range={range} collected={[...collected, ...markers]}>
      {children}
    </MarkerChain>
  );
}

interface MarkerChainProps {
  readonly sources: readonly CalendarDayMarkersDefinition[];
  readonly range: CalendarDayMarkerRange;
  readonly collected: readonly CalendarDayMarker[];
  readonly children: (markers: readonly CalendarDayMarker[]) => ReactNode;
}

function MarkerChain({ sources, range, collected, children }: MarkerChainProps) {
  const [first, ...rest] = sources;
  if (first === undefined) return children(collected);
  return (
    <MarkerSource key={first.id} source={first} rest={rest} range={range} collected={collected}>
      {children}
    </MarkerSource>
  );
}

export interface DayMarkersProps {
  /** The first and last day on screen. */
  readonly range: CalendarDayMarkerRange;
  /** Draws the calendar with every registered source's markers for the range. */
  readonly children: (markers: readonly CalendarDayMarker[]) => ReactNode;
}

/**
 * Gathers the day markers of every registered source for the days on screen and hands them to
 * its child. With no source registered it only renders the child.
 */
export function DayMarkers({ range, children }: DayMarkersProps) {
  const sources = useCalendarDayMarkerSources();
  return (
    <MarkerChain sources={sources} range={range} collected={[]}>
      {children}
    </MarkerChain>
  );
}
