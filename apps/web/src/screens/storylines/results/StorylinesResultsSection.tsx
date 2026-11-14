import type { ReactNode } from 'react';
import { NOT_COUNTED_ENDED, NOT_COUNTED_NO_MEMBER } from '@ringside/engine';
import type {
  EventInstanceId,
  PersonId,
  SegmentResultView,
  ShowResultsView,
  StorylineId,
  StorylineShowProgressSegment,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { HeatChangeChip } from '@/components/HeatChangeChip';
import { ImageSlot } from '@/components/ImageSlot';
import { slotHeadingLabel } from '@/components/SegmentResultCard';
import { WorkerLink } from '@/components/WorkerLink';
import styles from './StorylinesResultsSection.module.css';

/** What CRTV4-06's story shield chip is drawn from: one member who lost inside a storyline. */
export interface ProtectedLoser {
  readonly personId: PersonId;
  readonly storylineId: StorylineId;
  readonly eventInstanceId: EventInstanceId;
}

export interface StorylinesResultsSectionProps {
  readonly eventInstanceId: EventInstanceId;
  readonly view: ShowResultsView;
  /**
   * Draws the story shield chip beside a loser (CRTV4-06 passes WRK8's `StoryShieldChip`).
   * Nothing is drawn there until then.
   */
  readonly renderShieldChip?: (loser: ProtectedLoser) => ReactNode;
}

export const RESULTS_LOADING_TEXT = 'Working out what the show did to your storylines…';

export const PAST_WINDOW_TEXT = 'Details are kept for the last 4 weeks.';

/** "Lost inside 'Ashfall Rivalry'". */
export function lostInsideText(storylineName: string): string {
  return `Lost inside '${storylineName}'`;
}

/**
 * "Not counted: nobody in this segment is in 'Ashfall Rivalry'": a link that moved nothing, with
 * the storyline named so the line reads on its own.
 */
export function notCountedText(storylineName: string, reason: string): string {
  if (reason === NOT_COUNTED_NO_MEMBER) {
    return `Not counted: nobody in this segment is in '${storylineName}'`;
  }
  if (reason === NOT_COUNTED_ENDED) return `Not counted: '${storylineName}' had already ended`;
  return `Not counted in '${storylineName}': ${reason}`;
}

/** True when the section has anything to draw: the viewer's own show with a linked segment. */
export function showsStorylines(view: ShowResultsView): boolean {
  return view.mine && view.segments.some((segment) => segment.storylines.length > 0);
}

interface PersonFacts {
  readonly name: string;
  readonly imageRef: string | null;
}

function peopleOf(segment: SegmentResultView | undefined): ReadonlyMap<PersonId, PersonFacts> {
  const people = new Map<PersonId, PersonFacts>();
  for (const side of segment?.sides ?? []) {
    for (const member of side.members) {
      people.set(member.personId, { name: member.name, imageRef: member.imageRef });
    }
  }
  return people;
}

function SegmentRow({
  segment,
  result,
  eventInstanceId,
  renderShieldChip,
}: {
  readonly segment: StorylineShowProgressSegment;
  readonly result: SegmentResultView | undefined;
  readonly eventInstanceId: EventInstanceId;
  readonly renderShieldChip: ((loser: ProtectedLoser) => ReactNode) | undefined;
}) {
  const heading =
    result === undefined
      ? segment.preShow
        ? `Pre-show slot ${String(segment.slot + 1)}`
        : `Slot ${String(segment.slot + 1)}`
      : slotHeadingLabel(result);
  const people = peopleOf(result);
  const names = new Map(segment.rows.map((row) => [row.storylineId, row.name]));
  return (
    <li className={styles['segment']}>
      <h3 className={styles['slot']}>{heading}</h3>
      {segment.rows.length > 0 && (
        <ul className={styles['chips']} aria-label={`Heat changes in ${heading}`}>
          {segment.rows.map((row) => (
            <li key={row.storylineId}>
              <HeatChangeChip
                storylineName={row.name}
                before={row.heatBefore}
                after={row.heatAfter}
                traceRef={row.traceRef}
                finale={row.finale}
              />
            </li>
          ))}
        </ul>
      )}
      {segment.notCounted.map((link) => (
        <p key={link.storylineId} className={styles['muted']}>
          {notCountedText(link.name, link.reason)}
        </p>
      ))}
      {segment.protectedLosers.length > 0 && (
        <ul className={styles['losers']} aria-label={`Lost inside a storyline in ${heading}`}>
          {segment.protectedLosers.map((loser) => {
            const person = people.get(loser.personId);
            const name = person?.name ?? 'Someone';
            return (
              <li key={`${loser.personId}-${loser.storylineId}`} className={styles['loser']}>
                <ImageSlot
                  subject={{
                    kind: 'person',
                    id: loser.personId,
                    name,
                    ...(person?.imageRef === undefined || person.imageRef === null
                      ? {}
                      : { imageRef: person.imageRef }),
                  }}
                  size="sm"
                  decorative
                />
                <WorkerLink personId={loser.personId} name={name} />
                <span className={styles['lostInside']}>
                  {lostInsideText(names.get(loser.storylineId) ?? 'a storyline')}
                </span>
                {renderShieldChip?.({ ...loser, eventInstanceId })}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/**
 * The results page's "Storylines" section (CRTV4-05): for each linked segment of the player's
 * show, in running order, how it moved each storyline's heat (with Why?), the links that didn't
 * count and why, and the members who lost inside a storyline it counted for. A rival's show has
 * no section: its heat is private.
 */
export function StorylinesResultsSection({
  eventInstanceId,
  view,
  renderShieldChip,
}: StorylinesResultsSectionProps) {
  const query = useEngineQuery('storylines.showProgress', { eventInstanceId });
  if (query.data === undefined) {
    return query.status === 'loading' ? (
      <p className={styles['muted']}>{RESULTS_LOADING_TEXT}</p>
    ) : null;
  }
  const progress = query.data;
  if (progress.kind === 'unavailable' || progress.segments.length === 0) return null;
  const order = new Map(view.segments.map((segment, index) => [segment.segmentId, index]));
  const results = new Map(view.segments.map((segment) => [segment.segmentId, segment]));
  const segments = [...progress.segments].sort(
    (left, right) =>
      (order.get(left.segmentId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.segmentId) ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    <div className={styles['section']}>
      {progress.pastDetailWindow && <p className={styles['muted']}>{PAST_WINDOW_TEXT}</p>}
      <ol className={styles['segments']}>
        {segments.map((segment) => (
          <SegmentRow
            key={segment.segmentId}
            segment={segment}
            result={results.get(segment.segmentId)}
            eventInstanceId={eventInstanceId}
            renderShieldChip={renderShieldChip}
          />
        ))}
      </ol>
    </div>
  );
}
