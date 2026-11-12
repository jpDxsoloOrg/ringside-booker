// The results page's extension slot, for features that add a section under a show's segments
// (MTCH3's popularity, EVT4's card flow, ECO's show money, CRTV, BRW3). The page itself is loaded
// by the router as its own chunk; importing this file does not pull it in.
export { listResultsSections, registerResultsSection } from './resultsSectionRegistry';
export type { ResultsSectionDefinition, ResultsSectionProps } from './resultsSectionRegistry';
