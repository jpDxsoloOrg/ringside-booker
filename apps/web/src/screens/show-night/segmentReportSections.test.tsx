import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { EngineProvider } from '@/app/engine/EngineProvider';
import {
  promoSegment,
  segmentResultTraces,
  singlesWin,
} from '@/screens/dev-gallery/fixtures/segmentResults';
import { createTraceFixtureTransport } from '@/screens/dev-gallery/fixtures/traceEngine';
import type { SegmentResultView, ShowResultsView } from '@ringside/engine';
import { parseGameDate, parseId } from '@ringside/engine';
import { SegmentReport } from './SegmentReport';
import { listSegmentReportSections, registerSegmentReportSection } from './segmentReportSections';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const SHOW = parseId('eventInstance', 'evi_0000000953');

function show(segment: SegmentResultView): ShowResultsView {
  return {
    eventInstanceId: SHOW,
    name: 'Test Weekly',
    date: parseGameDate('2031-03-14'),
    airDate: parseGameDate('2031-03-14'),
    status: 'scheduled',
    promotion: {
      id: parseId('promotion', 'pro_0000000953'),
      name: 'Test Promotion',
      color: '#2bb3c0',
      logoRef: null,
    },
    brand: null,
    importance: 'regular',
    format: { slots: 5, preShowSlots: 0 },
    region: { id: parseId('region', 'reg_0000000953'), name: 'Bayshore' },
    venue: null,
    mine: true,
    offscreen: false,
    result: null,
    segments: [segment],
    history: null,
  };
}

function renderReport(segment: SegmentResultView) {
  render(
    <MemoryRouter>
      <EngineProvider createTransport={() => createTraceFixtureTransport(segmentResultTraces())}>
        <SegmentReport eventInstanceId={SHOW} segment={segment} view={show(segment)} />
      </EngineProvider>
    </MemoryRouter>,
  );
}

describe('registerSegmentReportSection', () => {
  it('lists sections by order, then id, and removes one again', () => {
    const before = listSegmentReportSections().length;
    cleanups.push(
      registerSegmentReportSection({ id: 'test.b', label: 'B', order: 20, render: () => 'b' }),
      registerSegmentReportSection({ id: 'test.a', label: 'A', order: 20, render: () => 'a' }),
    );
    const remove = registerSegmentReportSection({
      id: 'test.first',
      label: 'First',
      order: 1,
      render: () => 'first',
    });
    const ids = listSegmentReportSections()
      .map((section) => section.id)
      .filter((id) => id.startsWith('test.'));
    expect(ids).toEqual(['test.first', 'test.a', 'test.b']);
    remove();
    expect(listSegmentReportSections()).toHaveLength(before + 2);
  });

  it('refuses an id that is taken', () => {
    cleanups.push(
      registerSegmentReportSection({ id: 'test.once', label: 'Once', order: 5, render: () => 'x' }),
    );
    expect(() =>
      registerSegmentReportSection({
        id: 'test.once',
        label: 'Twice',
        order: 6,
        render: () => 'y',
      }),
    ).toThrow(/already registered/);
  });

  it('draws each section under its heading after the result card, and leaves out an empty one', () => {
    cleanups.push(
      registerSegmentReportSection({
        id: 'test.morale',
        label: 'Morale',
        order: 50,
        render: ({ segment }) => `Morale after ${segment.roleLabel}`,
      }),
      registerSegmentReportSection({
        id: 'test.matchesOnly',
        label: 'Matches only',
        order: 10,
        render: ({ segment }) => (segment.kind === 'match' ? 'A match section' : null),
      }),
    );
    renderReport(singlesWin());
    const morale = screen.getByRole('region', { name: 'Morale' });
    expect(within(morale).getByText(/^Morale after /)).toBeInTheDocument();
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(['Matches only', 'Morale']);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('leaves a section out for a segment it has nothing to say about', () => {
    cleanups.push(
      registerSegmentReportSection({
        id: 'test.matchesOnly',
        label: 'Matches only',
        order: 10,
        render: ({ segment }) => (segment.kind === 'match' ? 'A match section' : null),
      }),
    );
    renderReport(promoSegment());
    expect(screen.queryByRole('region', { name: 'Matches only' })).toBeNull();
  });
});
