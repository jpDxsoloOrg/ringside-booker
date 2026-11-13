import { describe, expect, it } from 'vitest';
import { galleryShowMoneyRows } from '@/screens/dev-gallery/fixtures/showMoney';
import { resultsSectionAnchor } from '@/screens/show-results/showReportLineRegistry';
import { SHOW_MONEY_SECTION_ID } from './registerShowMoney';
import { showMoneyReportLine } from './showMoneyReportLine';

describe('the show report Money line (ECO1)', () => {
  it("gives the show's net and links to the Show money section", () => {
    const rows = galleryShowMoneyRows;
    const net = rows.reduce((sum, row) => sum + row.amount, 0);
    const line = showMoneyReportLine(rows, 'full');
    if (line === null) throw new Error('Expected a line');
    expect(line.label).toBe('Money');
    expect(line.text).toMatch(/ net for this show$/);
    expect(line.text.startsWith(net < 0 ? '−' : '+')).toBe(true);
    expect(line.tone).toBe(net < 0 ? 'negative' : 'positive');
    expect(line.targetId).toBe(resultsSectionAnchor(SHOW_MONEY_SECTION_ID));
  });

  it('is left out when the show posted nothing', () => {
    expect(showMoneyReportLine([], 'compact')).toBeNull();
  });
});
