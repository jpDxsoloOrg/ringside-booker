import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { ShowResultsView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import {
  drawResult,
  noContestResult,
  promoSegment,
  singlesWin,
  tagNewChampions,
  tripleThreatRetained,
} from '@/screens/dev-gallery/fixtures/segmentResults';
import { galleryBreakdown } from '@/screens/dev-gallery/fixtures/showReport';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import { orderedReportLines, ShowReport } from './ShowReport';
import {
  listShowReportLines,
  registerShowReportLine,
  segmentCardAnchor,
} from './showReportLineRegistry';
import { pointsText } from './showReportText';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Pre-show, opener, new tag champions, draw, no contest, main event title defence; slot 3 empty. */
function show(): ShowResultsView {
  const segments = [
    promoSegment(),
    singlesWin(),
    tagNewChampions(),
    drawResult(),
    noContestResult(),
    tripleThreatRetained(),
  ];
  const { breakdown, score } = galleryBreakdown(segments, ['Slot 6 (Midcard) is empty']);
  return {
    eventInstanceId: parseId('eventInstance', 'evi_0000000961'),
    name: 'Test Weekly',
    date: parseGameDate('2031-03-14'),
    airDate: parseGameDate('2031-03-14'),
    status: 'completed',
    promotion: {
      id: parseId('promotion', 'pro_0000000961'),
      name: 'Test Promotion',
      color: '#2bb3c0',
      logoRef: null,
    },
    brand: null,
    importance: 'regular',
    format: { slots: 6, preShowSlots: 1 },
    region: { id: parseId('region', 'reg_0000000961'), name: 'Test Region' },
    venue: null,
    mine: true,
    offscreen: false,
    result: {
      score,
      rawScore: score,
      stars: 2.5,
      scoreTraceRef: null,
      breakdown,
      attendance: null,
      gate: null,
      viewers: null,
    },
    segments,
  };
}

function renderReport(view: ShowResultsView, expectation: number | null = null) {
  const { result } = view;
  if (result === null) throw new Error('No result');
  render(
    <EngineProvider createTransport={() => createTraceFixtureTransport([])}>
      <ShowReport view={view} result={result} expectation={expectation} tableLayout="table" />
      {view.segments.map((segment) => (
        <article key={segment.segmentId} id={segmentCardAnchor(segment.segmentId)}>
          {segment.roleLabel}
        </article>
      ))}
    </EngineProvider>,
  );
  return screen.getByRole('region', { name: 'Show report' });
}

describe('ShowReport', () => {
  it('heads the report with the verdict, the score and stars, and the best and worst segment', () => {
    const view = show();
    const report = renderReport(view, (view.result?.score ?? 0) - 3);
    const score = String(view.result?.score);
    expect(
      within(report).getByText(
        `A solid show: ${score}, 2.5 stars, 3 points above what fans expected`,
      ),
    ).toBeInTheDocument();
    const highlights = within(report).getByRole('list', { name: 'Best and worst segment' });
    expect(within(highlights).getByText('Best')).toBeInTheDocument();
    expect(within(highlights).getByRole('link', { name: /^Main event: / })).toBeInTheDocument();
    expect(within(highlights).getByRole('link', { name: /^Semi-main: / })).toBeInTheDocument();
  });

  it('shows one table row per breakdown row, with the same shares, adding up to the score', () => {
    const view = show();
    const breakdown = view.result?.breakdown;
    if (breakdown === null || breakdown === undefined) throw new Error('No breakdown');
    renderReport(view);
    const table = screen.getByRole('grid', { name: /How the show score was worked out/ });
    const rows = within(table).getAllByRole('row').slice(1);
    // Every breakdown row, the pre-show factor and the total.
    expect(rows).toHaveLength(breakdown.rows.length + 2);
    const shares = rows.map((row) => row.lastElementChild?.textContent);
    for (const row of breakdown.rows) {
      expect(shares).toContain(pointsText(row.points));
    }
    expect(shares.at(-1)).toBe(String(view.result?.score));
    const sum = breakdown.rows.reduce((total, row) => total + row.points, 0);
    expect(sum).toBeCloseTo(view.result?.score ?? -1, 9);
    expect(within(table).getByText('Slot 6 (Midcard) is empty')).toBeInTheDocument();
    expect(within(table).getByText('Pre-show factor')).toBeInTheDocument();
  });

  it('links each segment row to its card and moves focus there', async () => {
    const user = userEvent.setup({ delay: null });
    renderReport(show());
    const table = screen.getByRole('grid', { name: /How the show score was worked out/ });
    await user.click(within(table).getByRole('link', { name: /^Opener: / }));
    expect(document.activeElement?.textContent).toBe('Opener');
  });

  it('says so when the breakdown is no longer kept', () => {
    const view = show();
    const result = view.result;
    if (result === null) throw new Error('No result');
    renderReport({ ...view, result: { ...result, breakdown: null } });
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.getByText(/kept for recent shows only/)).toBeInTheDocument();
  });

  it('lists title changes, defences and appearances in What changed', () => {
    const report = renderReport(show());
    const changed = within(report).getByRole('region', { name: 'What changed' });
    const lines = within(changed).getAllByRole('listitem');
    expect(lines.map((line) => line.querySelector('span')?.textContent)).toEqual([
      'New champion',
      'Title defence',
      'Appearances',
    ]);
    expect(within(changed).getByText(/won the/)).toBeInTheDocument();
    expect(within(changed).getByText(/people appeared$/)).toBeInTheDocument();
  });

  it('orders registered lines among the built-in ones and leaves out a line with nothing to say', () => {
    cleanups.push(
      registerShowReportLine({
        id: 'test.late',
        order: 50,
        line: () => ({ label: 'Late', text: 'last' }),
      }),
      registerShowReportLine({
        id: 'test.early',
        order: 5,
        line: () => ({ label: 'Early', text: 'first', tone: 'positive' }),
      }),
      registerShowReportLine({ id: 'test.silent', order: 20, line: () => null }),
    );
    expect(orderedReportLines(listShowReportLines()).map((line) => line.id)).toEqual([
      'test.early',
      'evt3.titleChanges',
      'evt3.titleDefences',
      'evt3.appearances',
      'test.silent',
      'test.late',
    ]);
    const report = renderReport(show());
    const changed = within(report).getByRole('region', { name: 'What changed' });
    const labels = within(changed)
      .getAllByRole('listitem')
      .map((line) => line.querySelector('span')?.textContent);
    expect(labels).toEqual(['Early', 'New champion', 'Title defence', 'Appearances', 'Late']);
  });

  it('refuses a second line with the same id', () => {
    cleanups.push(registerShowReportLine({ id: 'test.once', order: 1, line: () => null }));
    expect(() => registerShowReportLine({ id: 'test.once', order: 2, line: () => null })).toThrow(
      /already registered/,
    );
  });
});
