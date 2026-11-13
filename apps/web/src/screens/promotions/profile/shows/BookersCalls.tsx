/**
 * The results page's "Booker's calls" section (AIP5-05): on a rival's show that has run, one row
 * per match the computer booker decided, with its slot and `RivalResultLine` (winner, method,
 * reason and title badges, each with its Why?). Talking segments get no row. The rows come from
 * `aip.showDecisions`; your own shows have no booker's calls, so the section is left out for them
 * (see `showsBookersCalls`).
 */
import type { SegmentDecisionView, SegmentResultView, ShowResultsView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import { RivalResultLine } from './RivalResultLine';
import type { RivalResultSide } from './RivalResultLine';
import styles from './BookersCalls.module.css';

export const NO_BOOKERS_CALLS_TEXT = "The booker's calls are not kept for this show";
export const BOOKERS_CALLS_ERROR_TEXT = "The booker's calls could not be looked up";

/**
 * Whether the section draws: a show someone else ran that has been played out with its card
 * kept (not off-screen, not rolled up) and at least one match on it.
 */
export function showsBookersCalls(view: ShowResultsView): boolean {
  return (
    !view.mine &&
    view.status === 'completed' &&
    !view.offscreen &&
    view.segments.some((segment) => segment.kind === 'match')
  );
}

/** "Slot 3 · Midcard", "Pre-show 1". */
export function bookersCallSlotText(
  segment: Pick<SegmentResultView, 'preShow' | 'slotNumber' | 'roleLabel'>,
): string {
  return segment.preShow
    ? `Pre-show ${String(segment.slotNumber)}`
    : `Slot ${String(segment.slotNumber)} · ${segment.roleLabel}`;
}

function sidesOf(segment: SegmentResultView): RivalResultSide[] {
  return segment.sides.map((side) => ({
    name: side.label,
    people: side.members
      .filter((member) => member.role === 'competitor')
      .map((member) => ({ personId: member.personId, name: member.name })),
  }));
}

function matchLabelOf(segment: SegmentResultView): string {
  return segment.label ?? segment.sides.map((side) => side.label).join(' vs ');
}

export function BookersCallsList({
  view,
  decisions,
}: {
  readonly view: ShowResultsView;
  readonly decisions: readonly SegmentDecisionView[];
}) {
  const bySegment = new Map(decisions.map((decision) => [decision.segmentId, decision]));
  const rows = view.segments.flatMap((segment) => {
    const decision = bySegment.get(segment.segmentId);
    return segment.kind === 'match' && decision !== undefined ? [{ segment, decision }] : [];
  });
  if (rows.length === 0) {
    return <EmptyState icon="info" size="inline" headingLevel={3} title={NO_BOOKERS_CALLS_TEXT} />;
  }
  return (
    <ol className={styles['list']} aria-label="Booker's calls">
      {rows.map(({ segment, decision }) => (
        <li key={segment.segmentId} className={styles['row']}>
          <span className={styles['slot']}>{bookersCallSlotText(segment)}</span>
          <RivalResultLine
            view={decision}
            sides={sidesOf(segment)}
            matchLabel={matchLabelOf(segment)}
            compact
          />
        </li>
      ))}
    </ol>
  );
}

/** The section body: asks the engine for the show's calls. */
export function BookersCalls({ view }: { readonly view: ShowResultsView }) {
  const calls = useEngineQuery('aip.showDecisions', { eventInstanceId: view.eventInstanceId });
  if (calls.status === 'loading') {
    return <p className={styles['muted']}>Looking up the booker’s calls…</p>;
  }
  if (calls.status === 'error') {
    // Not "not kept": the calls may well be there, the lookup failed.
    return (
      <EmptyState icon="warning" size="inline" headingLevel={3} title={BOOKERS_CALLS_ERROR_TEXT} />
    );
  }
  return <BookersCallsList view={view} decisions={calls.data?.decisions ?? []} />;
}
