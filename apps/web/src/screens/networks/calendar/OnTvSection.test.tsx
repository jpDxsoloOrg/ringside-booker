import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { AiringRow, ShowAiringView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { galleryRivalShow, galleryShow } from '@/screens/dev-gallery/fixtures/calendar';
import { aftermathShow } from '@/screens/match-aftermath/aftermathResultsFixtures';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { ResultsBroadcastLines } from '../results/ResultsBroadcastSection';
import { showsBroadcast } from '../results/register';
import { ON_TV_SECTION, OnTvLines, onTvShowId } from './OnTvSection';

const DEAL = parseId('deal', 'dea_0000000001');
const SHOW = parseId('eventInstance', 'evi_0000000001');

/** Draws `ui` with an engine behind it, which the Why? buttons ask for their breakdown. */
function renderWithEngine(ui: ReactNode) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return render(<EngineProvider createTransport={() => transport}>{ui}</EngineProvider>);
}

const NSN = { dealId: DEAL, networkName: 'National Signal Network', kind: 'tv' as const };

function row(overrides: Partial<AiringRow> = {}): AiringRow {
  return {
    airingId: parseId('airing', 'air_0000000001'),
    airDate: parseGameDate('2027-01-08'),
    showName: 'Altura Mainstage',
    eventInstanceId: SHOW,
    dealId: DEAL,
    networkName: 'National Signal Network',
    status: 'aired',
    missReason: null,
    qualitySource: 'show',
    viewers: 2_412_345,
    expectedViewers: 1_903_000,
    income: 160_000_000,
    sharesPaid: 0,
    cost: 20_000_000,
    net: 140_000_000,
    traceRef: { kind: 'broadcast.airing', id: 'air_0000000001' },
    note: null,
    ...overrides,
  };
}

function aired(overrides: Partial<AiringRow> = {}): ShowAiringView {
  const airing = row(overrides);
  return {
    deals: [NSN],
    airing: {
      status: 'aired',
      viewers: airing.viewers,
      expectedViewers: airing.expectedViewers,
      missReason: null,
      income: airing.income,
      note: null,
    },
    airings: [airing],
    upcoming: false,
  };
}

const UPCOMING: ShowAiringView = { deals: [NSN], airing: null, airings: [], upcoming: true };

const RIVAL_AIRED = aired({
  income: null,
  sharesPaid: null,
  cost: null,
  net: null,
  traceRef: null,
});

const MISSED: ShowAiringView = {
  deals: [NSN],
  airing: {
    status: 'missed',
    viewers: 0,
    expectedViewers: 1_903_000,
    missReason: 'showCancelled',
    income: 0,
    note: 'Show cancelled: nothing aired',
  },
  airings: [
    row({
      status: 'missed',
      missReason: 'showCancelled',
      qualitySource: null,
      viewers: 0,
      income: 0,
      net: 0,
      cost: 0,
      note: 'Show cancelled: nothing aired',
    }),
  ],
  upcoming: false,
};

describe('the calendar show sheet’s On TV section (ECO8-07)', () => {
  it('sits after the crowd as "On TV"', () => {
    expect(ON_TV_SECTION).toMatchObject({ id: 'eco.airing', order: 30, title: 'On TV' });
  });

  it('says where one of your shows will air', () => {
    render(<OnTvLines view={UPCOMING} isOwn />);
    expect(screen.getByText('Airs on National Signal Network (TV deal)')).toBeInTheDocument();
  });

  it('shows an aired show’s viewers and money with its Why? for your own show', () => {
    renderWithEngine(<OnTvLines view={aired()} isOwn />);
    expect(screen.getByText('National Signal Network: 2.4M viewers · $1.6M')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Why is Altura Mainstage on National Signal Network/ }),
    ).toBeInTheDocument();
  });

  it('says a missed airing paid nothing and why', () => {
    render(<OnTvLines view={MISSED} isOwn />);
    expect(screen.getByText('Missed airing: show cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names a rival’s network and, once aired, its viewers, never money', () => {
    const { unmount } = render(<OnTvLines view={UPCOMING} isOwn={false} />);
    expect(screen.getByText('On National Signal Network')).toBeInTheDocument();
    unmount();
    render(<OnTvLines view={RIVAL_AIRED} isOwn={false} />);
    expect(screen.getByText('National Signal Network: 2.4M viewers')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('$');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('leaves out projected dates, house shows and untelevised shows still to run', () => {
    const own = galleryShow();
    expect(onTvShowId(own)).toBe(own.eventInstanceId);
    expect(onTvShowId({ ...own, eventInstanceId: null })).toBeNull();
    expect(onTvShowId({ ...own, importance: 'house' })).toBeNull();
    expect(onTvShowId({ ...own, televised: false })).toBeNull();
    expect(onTvShowId({ ...galleryRivalShow(0), televised: null })).not.toBeNull();
  });
});

describe('the results page’s On TV section (ECO8-07)', () => {
  it('names the network, viewers against expected and the money, with its Why?', () => {
    renderWithEngine(<ResultsBroadcastLines view={aired()} />);
    expect(
      screen.getByText(
        'On National Signal Network: 2.4M viewers (expected 1.9M) · TV rights $1.6M',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Why is Altura Mainstage on National Signal Network/ }),
    ).toBeInTheDocument();
  });

  it('draws only for your own shows that drew viewers on TV', () => {
    const show = aftermathShow();
    const result = show.result ?? expect.fail('the fixture has a result');
    const televised = { ...show, mine: true, result: { ...result, viewers: 2_412_345 } };
    expect(showsBroadcast(televised)).toBe(true);
    expect(showsBroadcast({ ...televised, mine: false })).toBe(false);
    expect(showsBroadcast({ ...televised, status: 'scheduled' })).toBe(false);
    expect(showsBroadcast({ ...televised, result: { ...result, viewers: null } })).toBe(false);
  });
});
