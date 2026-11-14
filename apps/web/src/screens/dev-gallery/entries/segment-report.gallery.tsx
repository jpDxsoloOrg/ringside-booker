import { parseGameDate, parseId } from '@ringside/engine';
import type { SegmentResultView, ShowResultsView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import type { EngineTransport } from '@/app/engine/transport';
import { Stack } from '@/components/layout';
import { SegmentReportView } from '@/screens/show-night/SegmentReport';
import type { SegmentReportSectionDefinition } from '@/screens/show-night/segmentReportSections';
import type { GalleryEntry } from '../galleryEntry';
import {
  promoSegment,
  segmentResultTraces,
  singlesWin,
  tagNewChampions,
} from '../fixtures/segmentResults';
import { createTraceFixtureTransport } from '../fixtures/traceEngine';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

/*
 * The report the show night screen shows after each segment (EVT10-02), with made-up segments:
 * every name is invented. The two sections stand in for what features register with
 * registerSegmentReportSection (MTCH3's popularity and momentum, MTCH4's physical toll); on the
 * real screen they read the engine.
 */

const SHOW = parseId('eventInstance', 'evi_0000000952');

function galleryShow(segments: readonly SegmentResultView[]): ShowResultsView {
  return {
    eventInstanceId: SHOW,
    name: 'Harbor Lights Showdown',
    date: parseGameDate('2031-03-14'),
    airDate: parseGameDate('2031-03-14'),
    status: 'scheduled',
    promotion: {
      id: parseId('promotion', 'pro_0000000952'),
      name: 'Coastline Wrestling',
      color: '#2bb3c0',
      logoRef: null,
    },
    brand: null,
    importance: 'major',
    format: { slots: 5, preShowSlots: 1 },
    region: { id: parseId('region', 'reg_0000000952'), name: 'Bayshore' },
    venue: null,
    mine: true,
    offscreen: false,
    result: null,
    segments: [...segments],
    history: null,
  };
}

/** Stand-ins for the sections features register; matches only, as theirs are. */
const DEMO_SECTIONS: readonly SegmentReportSectionDefinition[] = [
  {
    id: 'gallery.popularity',
    label: 'Popularity & momentum',
    order: 30,
    render: ({ segment }) =>
      segment.kind === 'match' ? (
        <p className={styles['caption']}>
          Each competitor&apos;s popularity in the show&apos;s region and momentum, before and
          after, with a Why? each.
        </p>
      ) : null,
  },
  {
    id: 'gallery.physical',
    label: 'Physical toll',
    order: 40,
    render: ({ segment }) =>
      segment.kind === 'match' ? (
        <p className={styles['caption']}>
          The fatigue each match added, the condition it took, learning and the injury chance.
        </p>
      ) : null,
  },
];

function createTransport(): EngineTransport {
  return createTraceFixtureTransport(segmentResultTraces());
}

interface ExampleProps {
  readonly title: string;
  readonly segment: SegmentResultView;
  readonly narrow?: boolean;
}

function Example({ title, segment, narrow = false }: ExampleProps) {
  return (
    <section className={styles['example']}>
      <h3 className={styles['subheading']}>{title}</h3>
      <div className={broadcast['stage']}>
        <div className={narrow ? broadcast['phoneColumn'] : undefined}>
          <SegmentReportView
            eventInstanceId={SHOW}
            segment={segment}
            view={galleryShow([segment])}
            sections={DEMO_SECTIONS}
            headingLevel={3}
          />
        </div>
      </div>
    </section>
  );
}

function SegmentReportDemo() {
  return (
    <EngineProvider createTransport={createTransport}>
      <Stack gap={5}>
        <Example
          title="A match: result, stars and score, top reasons, sections"
          segment={singlesWin()}
        />
        <Example title="A title change" segment={tagNewChampions()} />
        <Example title="A talking segment: no match sections" segment={promoSegment()} />
        <Example title="Phone width (390px)" segment={singlesWin()} narrow />
      </Stack>
    </EngineProvider>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'segment-report',
  title: 'Segment report',
  group: 'Broadcast',
  notes:
    "The report after each segment on show night (EVT10-02): the segment's result card (result and finish with its Why?, stars and score with the top reasons and the full trace, title outcomes), then the sections features add with registerSegmentReportSection, in order. A section with nothing to say for a segment is left out. The two sections here are stand-ins; on the real screen they read the engine.",
  render: () => <SegmentReportDemo />,
};
