import { describe, expect, it } from 'vitest';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import { aftermathReportLine } from './aftermathReportLine';
import { aftermathResult } from './aftermathResultsFixtures';
import { AFTERMATH_SECTION_ID } from './register';

describe('the show report Popularity line (MTCH3)', () => {
  it('counts each worker once as up, down or the same, and links to the section', () => {
    const data = aftermathResult();
    const line = aftermathReportLine(data);
    if (line === null) throw new Error('Expected a line');
    expect(line.label).toBe('Popularity');
    const workers = new Set(
      data.segments.flatMap((segment) => segment.workers.map((worker) => worker.personId)),
    );
    const counts = [...line.text.matchAll(/(\d+) (?:up|down|the same)/gu)].map((match) =>
      Number(match[1]),
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(workers.size);
    expect(line.targetId).toBe(resultsSectionAnchor(AFTERMATH_SECTION_ID));
  });

  it('is left out when no match changed anyone', () => {
    expect(aftermathReportLine({ segments: [] })).toBeNull();
  });
});
