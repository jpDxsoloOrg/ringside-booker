/**
 * MTCH4's part of the show night report (EVT10-02): after each match, the fatigue it added, the
 * condition it took, what the workers learned and their injury chance, from
 * `match.physicalForSegment`. Injuries themselves show as the "Injured" banner on the result card
 * (WRK6, through the results card banner registry). The show night screen loads this with its
 * own chunk.
 */
import { createElement } from 'react';
import { registerSegmentReportSection } from '@/screens/show-night/segmentReportSections';
import { PhysicalSegmentReport } from './PhysicalSegmentReport';
import { PHYSICAL_SECTION_LABEL, PHYSICAL_SECTION_ORDER } from './register';

/** The section's id in the segment report registry. */
export const PHYSICAL_REPORT_SECTION_ID = 'mtch4.physical';

registerSegmentReportSection({
  id: PHYSICAL_REPORT_SECTION_ID,
  label: PHYSICAL_SECTION_LABEL,
  order: PHYSICAL_SECTION_ORDER,
  render: ({ segment }) =>
    segment.kind === 'match' && segment.rating !== null
      ? createElement(PhysicalSegmentReport, { segmentId: segment.segmentId })
      : null,
});
