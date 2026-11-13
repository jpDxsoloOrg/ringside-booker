/**
 * The "What changed" lines the results page draws itself, from its own `shows.results` answer:
 * title changes, title defences and appearances. Features with their own data (fans, popularity,
 * money) add theirs with `registerShowReportLine`, and all of them are ordered together.
 */
import type { ShowResultsView } from '@ringside/engine';
import { formatNumber } from '@/components/format';
import { listText } from '@/components/SegmentResultCard/segmentResultText';
import { segmentCardAnchor } from './showReportLineRegistry';
import type { ShowReportLineContent, ShowReportLineDefinition } from './showReportLineRegistry';

/** The element id of the results page's main card section, for the appearances line. */
export const MAIN_CARD_ANCHOR = 'results-main-card';

/** "Kai Moreno won the Test World Title; Test Holders won the Test Tag Title". */
export function titleChangesLine(view: ShowResultsView): ShowReportLineContent | null {
  const changes = view.segments.flatMap((segment) =>
    segment.titles
      .filter((title) => title.outcome === 'newChampion')
      .map((title) => ({ segment, title })),
  );
  const [first] = changes;
  if (first === undefined) return null;
  const text = changes
    .map(({ title }) => `${listText(title.newHolderNames)} won the ${title.name}`)
    .join('; ');
  return {
    label: changes.length === 1 ? 'New champion' : 'New champions',
    text,
    tone: 'neutral',
    targetId: segmentCardAnchor(first.segment.segmentId),
  };
}

/** "Test Tag Title retained", "Test Tag Title and Test Second Title retained". */
export function titleDefencesLine(view: ShowResultsView): ShowReportLineContent | null {
  const defences = view.segments.flatMap((segment) =>
    segment.titles
      .filter((title) => title.outcome === 'retained')
      .map((title) => ({ segment, title })),
  );
  const [first] = defences;
  if (first === undefined) return null;
  return {
    label: defences.length === 1 ? 'Title defence' : 'Title defences',
    text: `${listText(defences.map(({ title }) => title.name))} retained`,
    tone: 'neutral',
    targetId: segmentCardAnchor(first.segment.segmentId),
  };
}

/** "11 people appeared": everyone on the card, counted once. */
export function appearancesLine(view: ShowResultsView): ShowReportLineContent | null {
  const people = new Set(
    view.segments.flatMap((segment) =>
      segment.sides.flatMap((side) => side.members.map((member) => member.personId)),
    ),
  );
  if (people.size === 0) return null;
  return {
    label: 'Appearances',
    text: `${formatNumber(people.size)} ${people.size === 1 ? 'person' : 'people'} appeared`,
    tone: 'neutral',
    targetId: MAIN_CARD_ANCHOR,
  };
}

/**
 * The built-in lines, in the same order space as registered ones: titles first (10, 11), then
 * appearances (15). EVT5's fans (25), MTCH3's popularity (30) and ECO's money (60) follow their
 * results sections' order.
 */
export const BUILTIN_REPORT_LINES: readonly ShowReportLineDefinition[] = [
  { id: 'evt3.titleChanges', order: 10, line: ({ view }) => titleChangesLine(view) },
  { id: 'evt3.titleDefences', order: 11, line: ({ view }) => titleDefencesLine(view) },
  { id: 'evt3.appearances', order: 15, line: ({ view }) => appearancesLine(view) },
];
