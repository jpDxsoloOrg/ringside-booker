import { describe, expect, it } from 'vitest';
import {
  bigTelevisedShowChange,
  showChangeWithStatus,
} from '@/screens/dev-gallery/fixtures/popularityShowChange';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import { popularityReportLine } from './popularityReportLine';
import { POPULARITY_SECTION_ID } from './register';

describe('the show report Fans line (EVT5)', () => {
  it('counts the regions won and lost, names the biggest change and links to the section', () => {
    const line = popularityReportLine(bigTelevisedShowChange);
    const summary = bigTelevisedShowChange.summary;
    if (line === null || summary === null) throw new Error('Expected a line');
    expect(line.label).toBe('Fans');
    expect(line.text).toContain(`${String(summary.regionsGained)} region`);
    expect(line.text).toMatch(/; most in .+ \([+−]\d/);
    expect(line.targetId).toBe(resultsSectionAnchor(POPULARITY_SECTION_ID));
  });

  it('is left out when the show changed nothing', () => {
    expect(popularityReportLine(showChangeWithStatus('notApplied'))).toBeNull();
    expect(popularityReportLine(showChangeWithStatus('pruned'))).toBeNull();
  });
});
