// The show night screen's extension slot (EVT10-02), for features that add a section to the
// report after each segment (MTCH3's popularity and momentum, MTCH4's physical toll, WRK8's morale
// once it exists). The screen itself is loaded by the router as its own chunk; importing this
// file does not pull it in.
export { listSegmentReportSections, registerSegmentReportSection } from './segmentReportSections';
export type {
  SegmentReportSectionDefinition,
  SegmentReportSectionProps,
} from './segmentReportSections';
