import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type {
  PersonId,
  SegmentResultView,
  ShowResultsView,
  ShowResultView,
} from '@ringside/engine';
import { ROUTE_HEADING_ATTRIBUTE } from '@/app/a11y/RouteFocus';
import { classNames } from '@/components/classNames';
import { formatGameDate, formatNumber } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { LowerThird } from '@/components/LowerThird';
import type { LowerThirdMetaItem } from '@/components/LowerThird';
import { Panel } from '@/components/Panel';
import { ScoreBug } from '@/components/ScoreBug';
import type { ScoreBugStat, ScoreBugStats } from '@/components/ScoreBug';
import { SegmentResultCard } from '@/components/SegmentResultCard';
import { IMPORTANCE_LABELS } from '@/components/ShowChip';
import { SlashDivider } from '@/components/SlashDivider';
import { StarRating } from '@/components/StarRating';
import { Explained } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { slotsText } from '@/screens/calendar/slotsText';
import { MAIN_CARD_ANCHOR } from './builtinReportLines';
import { RevealBar } from './RevealBar';
import { useResultsSections } from './resultsSectionRegistry';
import { ShowReport } from './ShowReport';
import { resultsSectionAnchor, segmentCardAnchor } from './showReportLineRegistry';
import { hasReport } from './showReportText';
import {
  headerAccent,
  offscreenNote,
  revealAnnouncement,
  scoreAnnouncement,
} from './showResultsText';
import styles from './ShowResults.module.css';
import { useRevealSequence } from './useRevealSequence';

/**
 * The results page's parts, drawn from a `shows.results` answer with no engine query of their
 * own, so the gallery can show them with made-up shows. `ShowResultsScreen` adds the route, the
 * loading and error states and the `?reveal` handling.
 */

function renderPersonLink(personId: PersonId, name: string): ReactNode {
  return <WorkerLink personId={personId} name={name} />;
}

/** Date, promotion, brand, importance, card size and where it was held. */
function headerMeta(view: ShowResultsView): readonly LowerThirdMetaItem[] {
  const items: LowerThirdMetaItem[] = [
    { id: 'date', label: formatGameDate(view.date, 'long'), icon: 'calendar' },
    { id: 'promotion', label: view.promotion.name },
  ];
  if (view.brand !== null && view.brand.name !== view.name) {
    items.push({ id: 'brand', label: view.brand.name });
  }
  items.push(
    { id: 'importance', label: IMPORTANCE_LABELS[view.importance] },
    { id: 'slots', label: slotsText(view.format) },
    { id: 'place', label: view.venue?.name ?? view.region.name, icon: 'building' },
  );
  return items;
}

export interface ResultsHeaderProps {
  readonly view: ShowResultsView;
  /** The line above the name: "Results", "Coming up". */
  readonly kicker: string;
  /**
   * True on the page itself: the name is the page's `h1` and where focus lands after a
   * navigation. False draws it as an `h2`, for the gallery.
   */
  readonly isPageHeading?: boolean;
}

/** The show's lower third: kicker, name, and the facts under it. */
export function ResultsHeader({ view, kicker, isPageHeading = true }: ResultsHeaderProps) {
  return (
    <LowerThird
      kicker={kicker}
      headingLevel={isPageHeading ? 1 : 2}
      title={
        isPageHeading ? (
          // RouteFocus lands here; the h1 itself belongs to the lower third.
          <span tabIndex={-1} data-route-heading="" className={styles['title']}>
            {view.name}
          </span>
        ) : (
          view.name
        )
      }
      meta={headerMeta(view)}
      accent={headerAccent(view.importance)}
      wedge
    />
  );
}

/** The score, the stars, and attendance and viewers once something fills them. */
function scoreStats(result: ShowResultView, scoreRevealed: boolean): ScoreBugStats {
  const pending = (
    <span className={styles['pending']}>
      <span aria-hidden="true">–</span>
      <VisuallyHidden>Coming up</VisuallyHidden>
    </span>
  );
  const score: ScoreBugStat = {
    id: 'score',
    label: 'Score',
    highlight: true,
    tone: 'prestige',
    value: scoreRevealed ? (
      <span className={styles['scoreIn']}>
        <Explained value={result.score} label="Show score" traceRef={result.scoreTraceRef} />
      </span>
    ) : (
      pending
    ),
  };
  const stars: ScoreBugStat = {
    id: 'stars',
    label: 'Stars',
    value: scoreRevealed ? (
      <span className={styles['scoreIn']}>
        <StarRating value={result.stars} tone="broadcast" />
      </span>
    ) : (
      pending
    ),
  };
  // Hidden until EVT6 and ECO8 fill them, rather than shown as 0.
  const extras: ScoreBugStat[] = [];
  if (result.attendance !== null) {
    extras.push({ id: 'attendance', label: 'Attendance', value: formatNumber(result.attendance) });
  }
  if (result.viewers !== null) {
    extras.push({ id: 'viewers', label: 'Viewers', value: formatNumber(result.viewers) });
  }
  const [first, second] = extras;
  if (first === undefined) return [score, stars];
  if (second === undefined) return [score, stars, first];
  return [score, stars, first, second];
}

interface CardListProps {
  readonly segments: readonly SegmentResultView[];
  readonly revealedCount: number;
  /** True when the reveal played, so each card fades in as it comes out. */
  readonly animated: boolean;
  readonly headingLevel: 2 | 3;
  /** True on the page itself: each card and the main card get the ids the report links to. */
  readonly anchors: boolean;
  /** While the reveal runs: reveals the next card, so tapping its placeholder brings it out. */
  readonly onRevealNext?: (() => void) | undefined;
}

/**
 * Keeps focus where it is (on Next segment, usually) when the placeholder is clicked or tapped,
 * instead of moving it onto a button that is about to go.
 */
function keepFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

/** The card in running order: the pre-show under its own divider, then the main card. */
function CardList({
  segments,
  revealedCount,
  animated,
  headingLevel,
  anchors,
  onRevealNext,
}: CardListProps) {
  const preShowHeadingId = useId();
  const mainHeadingId = useId();
  const SectionHeading = headingLevel === 2 ? 'h2' : 'h3';
  const cardHeadingLevel = headingLevel === 2 ? 3 : 4;
  const indexed = segments.map((segment, index) => ({ segment, index }));
  const preShow = indexed.filter(({ segment }) => segment.preShow);
  const mainCard = indexed.filter(({ segment }) => !segment.preShow);

  const renderList = (entries: typeof indexed) => (
    <ol className={styles['cardList']}>
      {entries.map(({ segment, index }) => {
        const revealed = index < revealedCount;
        return (
          <li
            key={segment.segmentId}
            className={classNames(styles['cardItem'], animated && revealed && styles['fadeIn'])}
            data-reveal-index={index}
          >
            <SegmentResultCard
              id={anchors ? segmentCardAnchor(segment.segmentId) : undefined}
              segment={segment}
              headingLevel={cardHeadingLevel}
              revealed={revealed}
              renderPersonLink={renderPersonLink}
            />
            {/* A pointer shortcut for Next segment, which stays the way in for keyboards and
                screen readers; so this one is out of the tab order and the accessibility tree. */}
            {onRevealNext !== undefined && index === revealedCount && (
              <button
                type="button"
                className={styles['tapToReveal']}
                tabIndex={-1}
                aria-hidden="true"
                onMouseDown={keepFocus}
                onClick={onRevealNext}
              />
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <>
      {preShow.length > 0 && (
        <section className={styles['cardSection']} aria-labelledby={preShowHeadingId}>
          <SectionHeading id={preShowHeadingId} className={styles['sectionHeading']}>
            Pre-show
          </SectionHeading>
          <SlashDivider decorative tone="data" />
          {renderList(preShow)}
        </section>
      )}
      {mainCard.length > 0 && (
        <section
          className={styles['cardSection']}
          aria-labelledby={mainHeadingId}
          id={anchors ? MAIN_CARD_ANCHOR : undefined}
        >
          <SectionHeading id={mainHeadingId} className={styles['sectionHeading']}>
            Main card
          </SectionHeading>
          <SlashDivider decorative tone="action" />
          {renderList(mainCard)}
        </section>
      )}
    </>
  );
}

/** What other features registered with `registerResultsSection`, each as a titled panel. */
function ResultsSections({ view }: { readonly view: ShowResultsView }) {
  const sections = useResultsSections();
  return (
    <>
      {sections.map((section) => {
        const content = section.render({ eventInstanceId: view.eventInstanceId, view });
        if (content === null || content === undefined || content === false) return null;
        return (
          <Panel
            key={section.id}
            id={resultsSectionAnchor(section.id)}
            title={section.label}
            headingLevel={2}
            variant="broadcast"
          >
            {content}
          </Panel>
        );
      })}
    </>
  );
}

/** What the live region says: the last card out, or the main event and the score at the end. */
function announcementOf(
  view: ShowResultsView,
  result: ShowResultView,
  revealedCount: number,
  scoreRevealed: boolean,
): string {
  if (scoreRevealed) {
    const mainEvent = view.segments.at(-1);
    const lead = mainEvent === undefined ? '' : `${revealAnnouncement(mainEvent)}. `;
    return `${lead}${scoreAnnouncement(result)}`;
  }
  const latest = view.segments[revealedCount - 1];
  return latest === undefined ? '' : revealAnnouncement(latest);
}

export interface CompletedResultsProps {
  readonly view: ShowResultsView;
  readonly result: ShowResultView;
  /** Play the tap-to-advance reveal (when motion is welcome). Read on mount. */
  readonly revealRequested: boolean;
  /** Called once, when every card and the score are showing. */
  readonly onRevealEnd?: () => void;
  /** False for the gallery: the show's name is an `h2` and nothing claims route focus. */
  readonly isPage?: boolean;
  /** The score fans in the show's region expected (EVT5), for the report's headline. */
  readonly expectation?: number | null;
}

/**
 * A show that has run: the header, the score, the show report (once the reveal is over), the card
 * (revealed or not) and the sections.
 */
export function CompletedResults({
  view,
  result,
  revealRequested,
  onRevealEnd,
  isPage = true,
  expectation = null,
}: CompletedResultsProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const sequence = useRevealSequence({
    total: view.segments.length,
    requested: revealRequested,
    ...(onRevealEnd === undefined ? {} : { onFinish: onRevealEnd }),
  });
  // Read on the first render only: the cards fade in only when the reveal ran.
  const [animated] = useState(sequence.playing);

  // A tap reveals the next card wherever it is: bring it into view above the reveal bar (the
  // cards' scroll margin leaves the bar's room), so a phone player never has to scroll to find it.
  const shownCount = useRef(sequence.revealedCount);
  useEffect(() => {
    const previous = shownCount.current;
    shownCount.current = sequence.revealedCount;
    if (!sequence.playing || sequence.revealedCount !== previous + 1) return;
    const card = headerRef.current?.parentElement?.querySelector<HTMLElement>(
      `[data-reveal-index="${String(sequence.revealedCount - 1)}"]`,
    );
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sequence.playing, sequence.revealedCount]);

  // The reveal buttons go when the reveal ends. When focus went with them, it moves to the show's
  // name, so the next Tab starts from the top of the results instead of the page's start.
  const wasPlaying = useRef(sequence.playing);
  useLayoutEffect(() => {
    if (wasPlaying.current && !sequence.playing) {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        const heading = headerRef.current?.querySelector<HTMLElement>(
          `[${ROUTE_HEADING_ATTRIBUTE}]`,
        );
        heading?.focus();
      }
    }
    wasPlaying.current = sequence.playing;
  }, [sequence.playing]);

  return (
    <div className={styles['screen']}>
      <div ref={headerRef} className={styles['header']}>
        <ResultsHeader view={view} kicker="Results" isPageHeading={isPage} />
        <ScoreBug
          label="Final score"
          stats={scoreStats(result, sequence.scoreRevealed)}
          className={styles['scoreBug']}
        />
      </div>

      {view.offscreen && <p className={styles['note']}>{offscreenNote(view.promotion.name)}</p>}
      {!view.offscreen && view.segments.length === 0 && (
        <p className={styles['note']}>Nothing was on this show&apos;s card.</p>
      )}

      {/* The report waits for the reveal, so it never gives a result away early. */}
      {!sequence.playing && hasReport(view) && (
        <ShowReport
          view={view}
          result={result}
          expectation={expectation}
          headingLevel={isPage ? 2 : 3}
        />
      )}

      {view.segments.length > 0 && (
        <CardList
          segments={view.segments}
          revealedCount={sequence.revealedCount}
          animated={animated}
          headingLevel={isPage ? 2 : 3}
          anchors={isPage}
          onRevealNext={sequence.playing ? sequence.next : undefined}
        />
      )}

      <p className={styles['live']} aria-live="polite">
        {animated
          ? announcementOf(view, result, sequence.revealedCount, sequence.scoreRevealed)
          : ''}
      </p>

      {sequence.playing && (
        <RevealBar
          onNext={sequence.next}
          onShowAll={sequence.showAll}
          nextLabel={sequence.finaleNext ? 'Show score' : 'Next segment'}
        />
      )}

      {!sequence.playing && <ResultsSections view={view} />}
    </div>
  );
}
