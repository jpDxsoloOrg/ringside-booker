import type { SegmentResultView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { SegmentResultCard } from '@/components/SegmentResultCard';
import type { GalleryEntry } from '../galleryEntry';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import {
  drawResult,
  longNamesResult,
  noContestResult,
  promoSegment,
  backstageInterview,
  segmentResultTraces,
  singlesWin,
  tagNewChampions,
  tripleThreatRetained,
} from '../fixtures/segmentResults';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

function createSegmentTraceTransport(): EngineTransport {
  return createTraceFixtureTransport(segmentResultTraces());
}

interface ExampleProps {
  readonly title: string;
  readonly segment: SegmentResultView;
  readonly revealed?: boolean;
  readonly narrow?: boolean;
}

function Example({ title, segment, revealed = true, narrow = false }: ExampleProps) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={broadcast['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : undefined}>
          <SegmentResultCard segment={segment} headingLevel={4} revealed={revealed} />
        </div>
      </div>
    </section>
  );
}

function SegmentResultCardDemo() {
  return (
    <EngineProvider createTransport={createSegmentTraceTransport}>
      <Stack gap={5}>
        <Example title="Singles, clean win" segment={singlesWin()} />
        <Example title="Tag match with a new champion" segment={tagNewChampions()} />
        <Example
          title="Triple threat main event, title retained"
          segment={tripleThreatRetained()}
        />
        <Example title="Draw" segment={drawResult()} />
        <Example title="No contest (no trace kept, so no Why?)" segment={noContestResult()} />
        <Example title="Talking segment on the pre-show" segment={promoSegment()} />
        <Example title="Backstage interview with roles (MTCH5-08)" segment={backstageInterview()} />
        <Example title="Not revealed yet" segment={tripleThreatRetained()} revealed={false} />
        <Example title="Very long ring names" segment={longNamesResult()} />
        <Example title="Phone width (390px)" segment={tagNewChampions()} narrow />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'segment-result-card',
  title: 'SegmentResultCard',
  group: 'Broadcast',
  notes:
    "One finished segment from shows.results (EVT3-05): slot and role, duration class and type chips, every side with the winner marked, the result line, stars and the numbers behind them with a Why?, storylines and the title banner. Unrevealed, it keeps its height and says what's coming up. A stand-in engine answers the Why? panels with small sample traces.",
  render: () => <SegmentResultCardDemo />,
};
