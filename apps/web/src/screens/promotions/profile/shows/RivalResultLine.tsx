/**
 * How a rival booker's match turned out and why (AIP5-05): "<winners> def. <losers> · <Method> ·
 * <Finish> · <reason>" with a Why? for the winner call, then a "Retained" or "New champion" badge
 * per title with its own Why? (reign days, the chance lines and the roll). Everything comes from
 * AIP5's `SegmentDecisionView` (`decision` on `aip.showCards` rows, `aip.showDecisions`): the web
 * never works out a winner or a reason. Plans are never shown, only what happened, and a reason
 * whose breakdown is no longer kept is plain text with no Why?. On a phone the method and reason
 * wrap onto their own line; each badge keeps its Why? beside it.
 * Design: docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */
import { Fragment } from 'react';
import type { PersonId, SegmentDecisionView, TraceNode, TraceRef } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { classNames } from '@/components/classNames';
import { traceSourceOf, WhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import styles from './RivalResultLine.module.css';

/** One side of the match as the line names it: a team or wrestler name and who is on it. */
export interface RivalResultSide {
  readonly name: string;
  readonly people: readonly { readonly personId: PersonId; readonly name: string }[];
}

export const RETAINED_TEXT = 'Retained';
export const NEW_CHAMPION_TEXT = 'New champion';
export const DRAW_TEXT = 'Draw';
export const NO_CONTEST_TEXT = 'No contest';

/** The name of the winner call's Why? button: "Why this result? Kai Moreno vs Rex Hale". */
export function resultWhyLabel(matchLabel: string): string {
  return `Why this result? ${matchLabel}`;
}

/** The name of a title's Why? button: "Why New champion? Coastal Heavyweight Title". */
export function titleWhyLabel(titleName: string, badge: string): string {
  return `Why ${badge}? ${titleName}`;
}

export interface RivalResultLineProps {
  readonly view: SegmentDecisionView;
  /** The match's sides in order, to name the losers and link single wrestlers to their profile. */
  readonly sides: readonly RivalResultSide[];
  /** The matchup ("Kai Moreno vs Rex Hale"), for the Why? buttons' names and panel titles. */
  readonly matchLabel: string;
  /** Smaller text, for the results page's Booker's calls list. */
  readonly compact?: boolean;
  /** Hands a breakdown over inline instead of fetching it (the gallery has no engine). */
  readonly traceOf?: ((ref: TraceRef) => TraceNode | null) | undefined;
  readonly className?: string | undefined;
}

function SideName({ side }: { readonly side: RivalResultSide }) {
  const [only] = side.people;
  if (side.people.length === 1 && only?.name === side.name) {
    return <WorkerLink personId={only.personId} name={side.name} />;
  }
  return <span className={styles['name']}>{side.name}</span>;
}

function SideNames({ sides }: { readonly sides: readonly RivalResultSide[] }) {
  return (
    <>
      {sides.map((side, index) => (
        <Fragment key={`${side.name}-${String(index)}`}>
          {index > 0 && (index === sides.length - 1 ? ' and ' : ', ')}
          <SideName side={side} />
        </Fragment>
      ))}
    </>
  );
}

/** The sides that won and lost, by the winners' people; null when no side holds them. */
function splitSides(
  sides: readonly RivalResultSide[],
  winners: readonly PersonId[],
): { won: RivalResultSide; lost: RivalResultSide[] } | null {
  const first = winners[0];
  if (first === undefined) return null;
  const won = sides.find((side) => side.people.some((person) => person.personId === first));
  if (won === undefined) return null;
  return { won, lost: sides.filter((side) => side !== won) };
}

function Outcome({ view, sides }: Pick<RivalResultLineProps, 'view' | 'sides'>) {
  const { winner } = view;
  if (winner.kind === 'draw') return <span className={styles['outcomeWord']}>{DRAW_TEXT}</span>;
  if (winner.kind === 'noContest') {
    return <span className={styles['outcomeWord']}>{NO_CONTEST_TEXT}</span>;
  }
  const split = splitSides(sides, winner.personIds);
  if (split === null) {
    return <span className={styles['name']}>{winner.sideLabel ?? ''}</span>;
  }
  return (
    <>
      <SideName side={split.won} />
      {split.lost.length > 0 && (
        <>
          {' def. '}
          <SideNames sides={split.lost} />
        </>
      )}
    </>
  );
}

/** "Pinfall · Clean finish · Higher value": the parts that exist, the reason last. */
function detailParts(view: SegmentDecisionView): string[] {
  const parts = [view.winner.methodName, view.winner.finishName];
  // A draw's reason is "Draw", already said by the outcome.
  const reason =
    view.reasonText === DRAW_TEXT && view.winner.kind === 'draw' ? null : view.reasonText;
  return [...parts, reason].filter((part): part is string => part !== null && part !== '');
}

/** One result line for a computer-booked match. See the module comment. */
export function RivalResultLine({
  view,
  sides,
  matchLabel,
  compact = false,
  traceOf,
  className,
}: RivalResultLineProps) {
  const winnerSource = traceSourceOf(
    view.winnerTraceRef === null ? null : traceOf?.(view.winnerTraceRef),
    view.winnerTraceRef,
  );
  const details = detailParts(view);
  const titles = view.titles.filter((title) => title.actual !== 'pending');
  return (
    <div
      className={classNames(styles['line'], compact && styles['compact'], className)}
      data-part="rival-result"
      data-outcome={view.winner.kind}
    >
      <div className={styles['main']}>
        <span className={styles['outcome']} data-part="outcome">
          <Outcome view={view} sides={sides} />
        </span>
        {details.length > 0 && (
          <span className={styles['details']} data-part="details">
            {details.join(' · ')}
          </span>
        )}
        {winnerSource !== null && (
          <WhyButton
            label={matchLabel}
            value={view.reasonText}
            buttonLabel={resultWhyLabel(matchLabel)}
            panelTitle={resultWhyLabel(matchLabel)}
            source={winnerSource}
          />
        )}
      </div>
      {titles.length > 0 && (
        <ul className={styles['titles']} aria-label="Titles on the line">
          {titles.map((title) => {
            const badge = title.actual === 'newChampion' ? NEW_CHAMPION_TEXT : RETAINED_TEXT;
            const source = traceSourceOf(
              title.traceRef === null ? null : traceOf?.(title.traceRef),
              title.traceRef,
            );
            return (
              <li key={title.titleId} className={styles['title']} data-actual={title.actual}>
                <span className={styles['badgeGroup']}>
                  <Badge tone={title.actual === 'newChampion' ? 'prestige' : 'neutral'}>
                    {badge}
                  </Badge>
                  {source !== null && (
                    <WhyButton
                      label={title.titleName}
                      value={title.reasonText}
                      buttonLabel={titleWhyLabel(title.titleName, badge)}
                      panelTitle={titleWhyLabel(title.titleName, badge)}
                      source={source}
                    />
                  )}
                </span>
                <span className={styles['titleText']}>
                  <span className={styles['titleName']}>{title.titleName}</span>
                  {title.reasonText !== '' && (
                    <span className={styles['titleReason']}>{title.reasonText}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
