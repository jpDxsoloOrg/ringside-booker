/**
 * A made-up show for the "Popularity & momentum" section's tests: every name is invented. The
 * card reuses the results page's segment fixtures; the aftermath is built from it, one row per
 * competitor of every match with a winner or a draw, as `match.aftermath` would answer.
 */
import { parseGameDate, parseId } from '@ringside/engine';
import type {
  AftermathResult,
  AftermathSegmentView,
  AftermathWorkerView,
  SegmentResultView,
  ShowResultsView,
  TraceRef,
} from '@ringside/engine';
import {
  drawResult,
  noContestResult,
  promoSegment,
  singlesWin,
  tagNewChampions,
  tripleThreatRetained,
} from '@/screens/dev-gallery/fixtures/segmentResults';

const REGION = { id: parseId('region', 'reg_0000000901'), name: 'Bayshore' };
const SHOW_ID = parseId('eventInstance', 'evi_0000000911');
const DATE = parseGameDate('2031-03-14');

/** A completed show: pre-show promo, then singles, draw, tag, no contest and the main event. */
export function aftermathShow(): ShowResultsView {
  return {
    eventInstanceId: SHOW_ID,
    name: 'Harbor Lights Showdown',
    date: DATE,
    airDate: DATE,
    status: 'completed',
    promotion: {
      id: parseId('promotion', 'pro_0000000901'),
      name: 'Coastline Wrestling',
      color: '#2bb3c0',
      logoRef: null,
    },
    brand: null,
    importance: 'major',
    format: { slots: 5, preShowSlots: 1 },
    region: REGION,
    venue: null,
    mine: true,
    offscreen: false,
    result: {
      score: 68,
      rawScore: 68,
      stars: 2.75,
      scoreTraceRef: null,
      breakdown: null,
      attendance: null,
      gate: null,
      viewers: null,
    },
    segments: [
      promoSegment(),
      singlesWin(),
      drawResult(),
      tagNewChampions(),
      noContestResult(),
      tripleThreatRetained(),
    ],
  };
}

function outcomeOf(segment: SegmentResultView, side: number): AftermathWorkerView['outcome'] {
  const outcome = segment.outcome;
  if (outcome?.kind !== 'win') return 'draw';
  return outcome.winningSide === side ? 'win' : 'loss';
}

let nextRow = 900;

function workerRow(
  segment: SegmentResultView,
  side: number,
  personId: AftermathWorkerView['personId'],
  name: string,
  options: { readonly withTraces: boolean; readonly contract: boolean },
): AftermathWorkerView {
  nextRow += 1;
  const outcome = outcomeOf(segment, side);
  const popularityChange = outcome === 'win' ? 2.4 : outcome === 'loss' ? -0.4 : -0.1;
  const momentumChange = outcome === 'win' ? 8 : outcome === 'loss' ? -6 : -2;
  const ref = (kind: string): TraceRef | null =>
    options.withTraces ? { kind, id: `${segment.segmentId}/${personId}` } : null;
  return {
    aftermathId: parseId('aftermath', `aft_0000000${String(nextRow)}`),
    personId,
    name,
    outcome,
    popularity: {
      delta: popularityChange,
      regions: [
        {
          regionId: REGION.id,
          name: REGION.name,
          before: 40,
          after: 40 + popularityChange,
          change: popularityChange,
        },
      ],
      traceRef: ref('match.popularityGain'),
    },
    momentum: options.contract
      ? {
          employmentId: parseId('employment', `emp_0000000${String(nextRow)}`),
          before: 10,
          after: 10 + momentumChange,
          change: momentumChange,
          traceRef: ref('match.momentumGain'),
        }
      : null,
  };
}

/** `match.aftermath` for {@link aftermathShow}: every match but the no contest, in card order. */
export function aftermathResult(
  options: { readonly withTraces?: boolean; readonly freeAgent?: boolean } = {},
): AftermathResult {
  const segments: AftermathSegmentView[] = [];
  for (const segment of aftermathShow().segments) {
    if (segment.kind !== 'match' || segment.outcome === null) continue;
    if (segment.outcome.kind === 'noContest') continue;
    const workers = segment.sides.flatMap((side) =>
      side.members
        .filter((member) => member.role === 'competitor')
        .map((member, index) =>
          workerRow(segment, side.side, member.personId, member.name, {
            withTraces: options.withTraces ?? true,
            contract: options.freeAgent !== true || index > 0 || side.side > 0,
          }),
        ),
    );
    segments.push({
      segmentId: segment.segmentId,
      eventInstanceId: SHOW_ID,
      eventName: 'Harbor Lights Showdown',
      date: DATE,
      preShow: segment.preShow,
      slot: segment.slot,
      showRegionId: REGION.id,
      showRegionName: REGION.name,
      workers,
    });
  }
  return { segments };
}
