import { render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { ShowSummaryView } from '@ringside/engine';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { resetSettingsForTest } from '@/test/settings';
import type { AdvanceReport } from './DayAdvanceProvider';
import { showToOpen, useOpenResultsAfterShow } from './useOpenResultsAfterShow';

afterEach(() => {
  resetSettingsForTest();
});

const DATE = parseGameDate('2031-03-14');

function summary(id: string, name: string): ShowSummaryView {
  return {
    eventInstanceId: parseId('eventInstance', id),
    name,
    date: DATE,
    promotionName: 'Test Promotion',
    mine: true,
    score: 60,
    stars: 2.5,
    scoreTraceRef: null,
    mainEvent: null,
    titleChanges: [],
  };
}

/** Newest first, as `shows.completedSince` lists them. */
const TWO_SHOWS = [summary('evi_0000000002', 'Test Late'), summary('evi_0000000001', 'Test Early')];

function report(): AdvanceReport {
  return {
    kind: 'advanced',
    daysRequested: 7,
    result: {
      startDate: DATE,
      endDate: parseGameDate('2031-03-21'),
      daysAdvanced: 7,
      stoppedBy: { kind: 'completed' },
      failures: [],
      eventsPublished: 0,
      timing: { ms: 1 },
    },
  };
}

function Probe({
  advance,
  results,
}: {
  readonly advance: AdvanceReport;
  readonly results: readonly ShowSummaryView[] | undefined;
}) {
  useOpenResultsAfterShow(advance, results);
  return null;
}

function renderProbe(advance: AdvanceReport, results: readonly ShowSummaryView[] | undefined) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Probe advance={advance} results={results} /> },
      { path: '*', element: null },
    ],
    { initialEntries: ['/'], future: routerFutureFlags },
  );
  const view = render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return { router, view };
}

describe('useOpenResultsAfterShow', () => {
  it('opens the first show the advance ran, with the reveal', async () => {
    const { router } = renderProbe(report(), TWO_SHOWS);
    const first = parseId('eventInstance', 'evi_0000000001');
    await waitFor(() => {
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        routes.game.showResults(first, { reveal: true }),
      );
    });
    expect(showToOpen(TWO_SHOWS)?.name).toBe('Test Early');
  });

  it('waits for the results and opens nothing when the advance ran none of your shows', async () => {
    const advance = report();
    const { router, view } = renderProbe(advance, undefined);
    view.unmount();
    renderProbe(advance, []);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('opens nothing with the setting off: the summary keeps its links', async () => {
    useSettingsStore.getState().update({ openResultsAfterShow: false });
    const { router } = renderProbe(report(), TWO_SHOWS);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('opens the results of one advance only once, even when the banner is drawn again', async () => {
    const advance = report();
    const first = renderProbe(advance, TWO_SHOWS);
    await waitFor(() => {
      expect(first.router.state.location.pathname).not.toBe('/');
    });
    first.view.unmount();
    const again = renderProbe(advance, TWO_SHOWS);
    await waitFor(() => {
      expect(again.router.state.location.pathname).toBe('/');
    });
  });
});
