import { parseGameDate, parseId } from '@ringside/engine';
import type { ShowResultsView, StoredTrace, TraceRef } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import type { DataTableLayout } from '@/components/DataTable';
import { Stack } from '@/components/layout';
import { ShowReport } from '@/screens/show-results/ShowReport';
import type { GalleryEntry } from '../galleryEntry';
import {
  drawResult,
  noContestResult,
  promoSegment,
  segmentResultTraces,
  singlesWin,
  tagNewChampions,
  tripleThreatRetained,
} from '../fixtures/segmentResults';
import { galleryBreakdown } from '../fixtures/showReport';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

/*
 * The show report at the top of a results page (EVT3-09), with a made-up show: every name is
 * invented. The breakdown is laid out the way the engine reads one from the show score trace.
 */

const SHOW_SCORE_REF: TraceRef = { kind: 'shows.showScore', id: 'evi_0000000951' };

function reportTraces(score: number): StoredTrace[] {
  return [
    ...segmentResultTraces(),
    {
      ref: SHOW_SCORE_REF,
      date: parseGameDate('2031-03-14'),
      seq: 200,
      trace: {
        kind: 'formula',
        label: 'Show score',
        value: score,
        children: [{ kind: 'input', label: 'Made up for the gallery', value: score }],
      },
      value: score,
    },
  ];
}

/** Pre-show promo, then opener, a new tag champion, a draw, a no contest and a title defence. */
function reportShow(): ShowResultsView {
  const segments = [
    promoSegment(),
    singlesWin(),
    tagNewChampions(),
    drawResult(),
    noContestResult(),
    tripleThreatRetained(),
  ].map((segment, index) =>
    // Laid out on a 5-slot main card in running order.
    segment.preShow ? segment : { ...segment, slot: index - 1, slotNumber: index },
  );
  const { breakdown, score } = galleryBreakdown(segments);
  return {
    eventInstanceId: parseId('eventInstance', 'evi_0000000951'),
    name: 'Harbor Lights Showdown',
    date: parseGameDate('2031-03-14'),
    airDate: parseGameDate('2031-03-14'),
    status: 'completed',
    promotion: {
      id: parseId('promotion', 'pro_0000000951'),
      name: 'Coastline Wrestling',
      color: '#2bb3c0',
      logoRef: null,
    },
    brand: null,
    importance: 'major',
    format: { slots: 5, preShowSlots: 1 },
    region: { id: parseId('region', 'reg_0000000951'), name: 'Bayshore' },
    venue: null,
    mine: true,
    offscreen: false,
    result: {
      score,
      rawScore: score,
      stars: 3,
      scoreTraceRef: SHOW_SCORE_REF,
      breakdown,
      attendance: null,
      gate: null,
      viewers: null,
    },
    segments,
    history: null,
  };
}

function createReportTransport(): EngineTransport {
  return createTraceFixtureTransport(reportTraces(reportShow().result?.score ?? 0));
}

interface ExampleProps {
  readonly title: string;
  readonly view: ShowResultsView;
  readonly expectation?: number | null;
  readonly narrow?: boolean;
  readonly layout?: DataTableLayout;
}

function Example({ title, view, expectation = null, narrow = false, layout }: ExampleProps) {
  const { result } = view;
  if (result === null) return null;
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={broadcast['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : undefined}>
          <ShowReport
            view={view}
            result={result}
            expectation={expectation}
            headingLevel={3}
            {...(layout === undefined ? {} : { tableLayout: layout })}
          />
        </div>
      </div>
    </section>
  );
}

function ShowReportDemo() {
  const show = reportShow();
  const old: ShowResultsView = {
    ...show,
    result: show.result === null ? null : { ...show.result, breakdown: null },
    segments: show.segments.map((segment) =>
      segment.rating === null
        ? segment
        : { ...segment, rating: { ...segment.rating, reasons: [] } },
    ),
  };
  const expectation = (show.result?.score ?? 0) - 3;
  return (
    <EngineProvider createTransport={createReportTransport}>
      <Stack gap={5}>
        <Example title="With the fans' expectation (EVT5)" view={show} expectation={expectation} />
        <Example title="Score and stars only" view={show} />
        <Example title="An older show: the breakdown is no longer kept" view={old} />
        <Example
          title="Phone width (390px): the table as cards"
          view={show}
          narrow
          layout="cards"
        />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'show-report',
  title: 'Show report',
  group: 'Broadcast',
  notes:
    "The top of a results page (EVT3-09): the verdict in words with the score, stars and (once EVT5 says) how it compared with what fans expected; the best and worst segment; How it was scored, one row per slot with its stars, score, weight and share, the pre-show factor and empty slots as rows, adding up to the show score, with the score's Why?; and What changed, from the built-in title and appearance lines and every feature's registerShowReportLine. The lines of features with their own engine queries (fans, popularity, money) don't show here. Every link jumps to the segment card or section lower on the real page.",
  render: () => <ShowReportDemo />,
};
