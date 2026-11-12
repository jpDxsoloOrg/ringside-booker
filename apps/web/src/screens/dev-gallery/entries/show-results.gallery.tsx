import { useState } from 'react';
import { parseGameDate, parseId } from '@ringside/engine';
import type { ShowResultsView, StoredTrace, TraceNode, TraceRef } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { AdvanceSummaryBanner } from '@/app/AppShell/day/AdvanceSummary';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { CompletedResults } from '@/screens/show-results/ResultsBroadcast';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import {
  drawResult,
  noContestResult,
  promoSegment,
  segmentResultTraces,
  singlesWin,
  tripleThreatRetained,
} from '../fixtures/segmentResults';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

/*
 * A made-up show for the results page's parts: every name is invented. The segment traces are the
 * SegmentResultCard entry's; the show score has a small one of its own.
 */

const SHOW_SCORE_REF: TraceRef = { kind: 'shows.showScore', id: 'evi_0000000901' };

const SHOW_SCORE_TRACE: TraceNode = {
  kind: 'formula',
  label: 'Show score',
  value: 68,
  children: [
    { kind: 'input', label: 'Main event: 74 × 1.75', value: 129.5 },
    { kind: 'input', label: 'Opener: 66 × 1', value: 66 },
    { kind: 'input', label: 'Divided by the total weight', value: 4.75 },
  ],
};

function showTraces(): StoredTrace[] {
  return [
    ...segmentResultTraces(),
    {
      ref: SHOW_SCORE_REF,
      date: parseGameDate('2031-03-14'),
      seq: 100,
      trace: SHOW_SCORE_TRACE,
      value: 68,
    },
  ];
}

function createShowTraceTransport(): EngineTransport {
  return createTraceFixtureTransport(showTraces());
}

/** A major show: a pre-show promo and four main-card segments (slot 3 empty), title retained. */
function sampleShow(): ShowResultsView {
  return {
    eventInstanceId: parseId('eventInstance', 'evi_0000000901'),
    name: 'Harbor Lights Showdown',
    date: parseGameDate('2031-03-14'),
    airDate: parseGameDate('2031-03-14'),
    status: 'completed',
    promotion: {
      id: parseId('promotion', 'pro_0000000901'),
      name: 'Coastline Wrestling',
      color: '#2bb3c0',
      logoRef: null,
    },
    brand: { id: parseId('brand', 'brd_0000000901'), name: 'Tidal' },
    importance: 'major',
    format: { slots: 5, preShowSlots: 1 },
    region: { id: parseId('region', 'reg_0000000901'), name: 'Bayshore' },
    venue: { id: parseId('venue', 'ven_0000000901'), name: 'Pier Nine Arena' },
    mine: true,
    offscreen: false,
    result: {
      score: 68,
      rawScore: 68,
      stars: 2.75,
      scoreTraceRef: SHOW_SCORE_REF,
      attendance: null,
      gate: null,
      viewers: null,
    },
    segments: [
      promoSegment(),
      singlesWin(),
      drawResult(),
      noContestResult(),
      tripleThreatRetained(),
    ],
  };
}

/** A rival's show the computer scored without a card. */
function offscreenShow(): ShowResultsView {
  const show = sampleShow();
  return {
    ...show,
    eventInstanceId: parseId('eventInstance', 'evi_0000000902'),
    name: 'Northside Uprising',
    promotion: { ...show.promotion, name: 'Northside Pro', color: '#c0392b' },
    brand: null,
    importance: 'regular',
    mine: false,
    offscreen: true,
    result: {
      score: 52,
      rawScore: 52,
      stars: 1.5,
      scoreTraceRef: null,
      attendance: null,
      gate: null,
      viewers: null,
    },
    segments: [],
  };
}

interface ExampleProps {
  readonly title: string;
  readonly view: ShowResultsView;
  readonly reveal?: boolean;
  readonly narrow?: boolean;
}

function Example({ title, view, reveal = false, narrow = false }: ExampleProps) {
  const [run, setRun] = useState(0);
  const { result } = view;
  if (result === null) return null;
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      {reveal && (
        <Button
          size="sm"
          iconStart="play"
          onClick={() => {
            setRun((count) => count + 1);
          }}
        >
          Play the reveal again
        </Button>
      )}
      <div className={broadcast['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : undefined}>
          <CompletedResults
            key={run}
            view={view}
            result={result}
            revealRequested={reveal}
            isPage={false}
          />
        </div>
      </div>
    </section>
  );
}

function ShowResultsDemo() {
  const show = sampleShow();
  const { result } = show;
  return (
    <EngineProvider createTransport={createShowTraceTransport}>
      <Stack gap={5}>
        <Example title="A major show, everything showing" view={show} />
        <Example title="The reveal (instant under reduced motion)" view={show} reveal />
        <Example title="A rival show scored off-screen" view={offscreenShow()} />
        <Example title="Phone width (390px)" view={show} narrow />
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>The Next Day summary&apos;s results links</h3>
          {result !== null && (
            <AdvanceSummaryBanner
              label="Last advance: show night"
              report={{
                kind: 'advanced',
                daysRequested: 1,
                result: {
                  startDate: show.date,
                  endDate: parseGameDate('2031-03-15'),
                  daysAdvanced: 1,
                  stoppedBy: { kind: 'completed' },
                  failures: [],
                  eventsPublished: 12,
                  timing: { ms: 40 },
                },
              }}
              results={[
                'Harbor Lights Showdown',
                'Tidal Weekly',
                'Pier Nine Live',
                'Late Tide',
              ].map((name, index) => ({
                eventInstanceId: parseId('eventInstance', `evi_000000091${String(index)}`),
                name,
                date: show.date,
                promotionName: show.promotion.name,
                mine: true,
                score: result.score,
                stars: result.stars,
                scoreTraceRef: null,
                mainEvent: null,
                titleChanges: [],
              }))}
              onDismiss={() => undefined}
            />
          )}
        </section>
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'show-results',
  title: 'Show results',
  group: 'Broadcast',
  notes:
    "The results page's parts (EVT3-06) with a made-up show: the lower third, the Final score bug with the score's Why?, the pre-show and main card as SegmentResultCards, the reveal with Next segment and Show all (press Play the reveal again; under reduced motion it shows everything at once), a rival show scored off-screen, and the Next Day summary's See results links. On the real page the show's name is the h1; here it is an h2.",
  render: () => <ShowResultsDemo />,
};
