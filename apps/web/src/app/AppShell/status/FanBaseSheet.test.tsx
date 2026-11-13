import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import type { EngineState, FanBaseView, OfficeSeries } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags } from '@/app/router';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerFanBaseColumn } from './fanBaseColumnRegistry';
import { StatusChips } from './StatusChips';
import {
  FanBaseSheet,
  FanBaseTrendBlock,
  fanBaseTrend,
  formatFanBasePopularity,
} from './FanBaseSheet';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

/**
 * The tiny world starts on Friday 10 April 2026. Eleven days cross two Mondays (13 and 20 April),
 * so the trend has two weekly records and today's value: three points.
 */
const DAYS_FOR_THREE_POINTS = 11;

const removers: (() => void)[] = [];

afterEach(() => {
  act(() => {
    for (const remove of removers.splice(0)) remove();
    useTracePanelStore.setState({ openPanelId: null });
  });
});

/**
 * The tiny world's promotion has no fans yet; give it some in every region of its home country
 * (40, 55, 70, ...) and one region abroad, so the drill-down has rows to open.
 */
function withFans(state: EngineState): EngineState {
  const { tables } = state.world;
  const regionsById = new Map(tables.regions.map((region) => [region.id, region]));
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...tables,
        promotions: tables.promotions.map((promotion) => {
          const home = regionsById.get(promotion.homeRegionId);
          const homeRegions = tables.regions.filter(
            (region) => region.countryId === home?.countryId,
          );
          const abroad = tables.regions.find((region) => region.countryId !== home?.countryId);
          const regionalPop: Record<string, number> = {};
          homeRegions.forEach((region, index) => {
            regionalPop[region.id] = 40 + 15 * index;
          });
          if (abroad !== undefined) regionalPop[abroad.id] = 10;
          return { ...promotion, regionalPop };
        }),
      },
    },
  };
}

interface Rendered {
  readonly transport: InProcessTransport;
  readonly fanBase: FanBaseView;
}

/** The fake engine with fans, `daysPlayed` days in, and its `office.fanBase` answer. */
async function setUpEngine(daysPlayed: number): Promise<Rendered> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(withFans(fakeEngineState()));
  if (daysPlayed > 0) {
    await transport.host.advanceDays({ maxDays: daysPlayed }, () => undefined);
  }
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const answer = await transport.host.query('office.fanBase', {});
  if (!answer.result.ok) throw new Error('office.fanBase was refused');
  return { transport, fanBase: answer.result.data };
}

async function renderSheet(daysPlayed = 0): Promise<Rendered> {
  const { transport, fanBase } = await setUpEngine(daysPlayed);
  render(
    <MemoryRouter future={routerFutureFlags}>
      <EngineProvider createTransport={() => transport}>
        <FanBaseSheet open onClose={() => undefined} />
      </EngineProvider>
    </MemoryRouter>,
  );
  return { transport, fanBase };
}

async function findSheet(name: string): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: `Fan base · ${name}` }, { timeout: LOAD_MS });
}

function homeContinentOf(fanBase: FanBaseView) {
  const continent = fanBase.rollup.continents.find(
    (candidate) => candidate.id === fanBase.home.continentId,
  );
  if (continent === undefined) throw new Error('The home continent is in the roll-up');
  return continent;
}

function homeCountryOf(fanBase: FanBaseView) {
  const country = homeContinentOf(fanBase).countries.find(
    (candidate) => candidate.id === fanBase.home.countryId,
  );
  if (country === undefined) throw new Error('The home country is in the roll-up');
  return country;
}

describe('FanBaseSheet', () => {
  it('shows the headline with its scope in words and opens the drill-down on the home continent', async () => {
    const { fanBase } = await renderSheet();
    const sheet = await findSheet(fanBase.name);

    expect(sheet).toHaveTextContent(formatFanBasePopularity(fanBase.headline.value));
    expect(sheet).toHaveTextContent(
      `Shown as popularity in your home country (${fanBase.home.countryName})`,
    );
    const continent = homeContinentOf(fanBase);
    expect(
      within(sheet).getByRole('button', { name: new RegExp(`^${continent.name}`, 'u') }),
    ).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(sheet).getByRole('list', { name: `Countries of ${continent.name}` }),
    ).toBeVisible();
  });

  it('lists the home country regions, whose population-weighted values add up to the headline', async () => {
    const { fanBase } = await renderSheet();
    const sheet = await findSheet(fanBase.name);
    const user = userEvent.setup({ delay: null });
    const country = homeCountryOf(fanBase);

    await user.click(
      within(sheet).getByRole('button', { name: new RegExp(`^${country.name}`, 'u') }),
    );
    const regions = within(sheet).getByRole('list', { name: `Regions of ${country.name}` });
    for (const region of country.regions) {
      expect(regions).toHaveTextContent(region.name);
    }
    const population = country.regions.reduce((sum, region) => sum + region.population, 0);
    const weighted = country.regions.reduce(
      (sum, region) => sum + (region.value * region.population) / population,
      0,
    );
    expect(weighted).toBeCloseTo(fanBase.headline.value, 2);
  });

  it('hides the trend with a single point, rather than promising one', () => {
    const { container } = render(
      <FanBaseTrendBlock trend={fanBaseTrend([], parseGameDate('2026-04-10'), 64)} weeks={8} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('draws the trend with three points, and its Why? replaces the sheet until it closes', async () => {
    const { fanBase } = await renderSheet(DAYS_FOR_THREE_POINTS);
    const sheet = await findSheet(fanBase.name);
    const user = userEvent.setup({ delay: null });

    expect(
      await within(sheet).findByRole(
        'img',
        { name: /^Popularity, last 8 weeks/u },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();

    await user.click(
      within(sheet).getByRole('button', {
        name: new RegExp(`^Why is ${fanBase.headline.label} `, 'u'),
      }),
    );
    await screen.findByRole('dialog', { name: fanBase.headline.label });
    expect(sheet.className).toMatch(/behindTrace/u);

    act(() => {
      useTracePanelStore.setState({ openPanelId: null });
    });
    await waitFor(() => {
      expect(sheet.className).not.toMatch(/behindTrace/u);
    });
  });

  it('draws a registered fan base column on every region', async () => {
    removers.push(
      registerFanBaseColumn({
        id: 'test.thisMonth',
        label: 'This month',
        render: () => '+1.0',
      }),
    );
    const { fanBase } = await renderSheet();
    const sheet = await findSheet(fanBase.name);
    const user = userEvent.setup({ delay: null });
    const country = homeCountryOf(fanBase);

    await user.click(
      within(sheet).getByRole('button', { name: new RegExp(`^${country.name}`, 'u') }),
    );
    const regions = within(sheet).getByRole('list', { name: `Regions of ${country.name}` });
    const cells = regions.querySelectorAll('[data-fan-base-column="test.thisMonth"]');
    expect(cells).toHaveLength(country.regions.length);
    expect(cells[0]).toHaveTextContent('This month +1.0');
  });
});

describe("the popularity chip's Why? (DAY2-05)", () => {
  it('lists the home country with every region, the scope setting and the notes', async () => {
    const { transport, fanBase } = await setUpEngine(DAYS_FOR_THREE_POINTS);
    const status = await transport.host.query('sim.status', {});
    if (!status.result.ok) throw new Error('sim.status was refused');
    render(
      <MemoryRouter future={routerFutureFlags}>
        <EngineProvider createTransport={() => transport}>
          <StatusChips status={status.result.data} placement="bar" />
        </EngineProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup({ delay: null });
    const chip = screen.getByTestId('popularity-chip');
    const chipNumber = chip.querySelector('.tabular')?.textContent ?? '';
    expect(chipNumber).not.toBe('');

    await user.click(
      within(chip).getByRole('button', {
        name: new RegExp(`^Why is ${fanBase.headline.label} `, 'u'),
      }),
    );
    const panel = await screen.findByRole(
      'dialog',
      { name: fanBase.headline.label },
      { timeout: LOAD_MS },
    );
    const country = homeCountryOf(fanBase);
    await waitFor(
      () => {
        expect(panel).toHaveTextContent(`Popularity in ${country.name}`);
      },
      { timeout: LOAD_MS },
    );
    for (const region of country.regions) {
      expect(panel).toHaveTextContent(region.name);
    }
    expect(panel).toHaveTextContent('office.popularity.headlineScope');
    expect(panel).toHaveTextContent(/Worldwide /u);
    expect(panel).toHaveTextContent(/Home region /u);
    expect(panel).toHaveTextContent(chipNumber);
  });
});

describe('fanBaseTrend', () => {
  const today = parseGameDate('2026-04-28');
  const points: OfficeSeries['points'] = [
    { date: parseGameDate('2026-04-13'), value: 60, granularity: 'week' },
    { date: parseGameDate('2026-04-20'), value: 62, granularity: 'week' },
    { date: parseGameDate('2026-04-27'), value: 63, granularity: 'week' },
  ];

  it('ends with the live value and compares with the last record a week or more old', () => {
    expect(fanBaseTrend(points, today, 64.5)).toEqual({ values: [60, 62, 63, 64.5], delta: 2.5 });
  });

  it('has no delta without a record that old, and one point with no records', () => {
    expect(fanBaseTrend(points.slice(2), today, 64).delta).toBeNull();
    expect(fanBaseTrend([], today, 64)).toEqual({ values: [64], delta: null });
  });
});
