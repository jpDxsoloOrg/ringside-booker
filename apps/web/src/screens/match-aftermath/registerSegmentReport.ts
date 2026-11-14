/**
 * MTCH3's part of the show night report (EVT10-02): after each match, what it did to its
 * competitors' popularity in the show's region and their momentum, from `match.aftermath
 * { segmentId }`. The show night screen loads this with its own chunk.
 */
import { createElement } from 'react';
import { registerSegmentReportSection } from '@/screens/show-night/segmentReportSections';
import { AftermathSegmentReport } from './AftermathSegmentReport';
import { AFTERMATH_SECTION_LABEL, AFTERMATH_SECTION_ORDER } from './register';

/** The section's id in the segment report registry. */
export const AFTERMATH_REPORT_SECTION_ID = 'mtch3.aftermath';

registerSegmentReportSection({
  id: AFTERMATH_REPORT_SECTION_ID,
  label: AFTERMATH_SECTION_LABEL,
  order: AFTERMATH_SECTION_ORDER,
  render: ({ segment, view }) =>
    segment.kind === 'match' && segment.rating !== null
      ? createElement(AftermathSegmentReport, {
          segmentId: segment.segmentId,
          promotionName: view.promotion.name,
        })
      : null,
});
