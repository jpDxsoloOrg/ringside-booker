/**
 * The results page's "Box office" section (EVT6-05): the cards drawn from the gallery's fixtures
 * (worked out with the engine's own formulas), the registration, and the section on a real results
 * page against the test engine, whose tiny world has one completed show with an attendance and a
 * gate written straight into it.
 */
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { parseId } from '@ringside/engine';
import type { ShowResultsView } from '@ringside/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import {
  galleryLossBoxOffice,
  galleryOwnBoxOffice,
  galleryRivalBoxOffice,
  gallerySoldOutBoxOffice,
} from '@/screens/dev-gallery/fixtures/boxOffice';
import { aftermathShow } from '@/screens/match-aftermath/aftermathResultsFixtures';
import { listResultsSections } from '@/screens/show-results/resultsSectionRegistry';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { BOX_OFFICE_TEXT, BoxOfficeKpis } from './BoxOfficeSection';
import type { BoxOfficeKpisProps } from './BoxOfficeSection';
import { BOX_OFFICE_SECTION_ID, BOX_OFFICE_SECTION_ORDER, showsBoxOffice } from './register';

const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

function renderKpis(data: BoxOfficeKpisProps) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  render(
    <EngineProvider createTransport={() => transport}>
      <BoxOfficeKpis {...data} />
    </EngineProvider>,
  );
  return screen.getByRole('group', { name: `Box office for ${data.showName}` });
}

const MONEY_CARDS = ['Gate', 'Venue rent', 'Live merch', 'Net'] as const;

describe('BoxOfficeKpis', () => {
  it("draws the player's show as five cards, each with a Why?", () => {
    const grid = renderKpis(galleryOwnBoxOffice);
    for (const label of ['Attendance', ...MONEY_CARDS]) {
      const card = within(grid).getByRole('group', { name: label });
      expect(
        within(card).getByRole('button', { name: new RegExp(`^Why is ${label} at `) }),
      ).toBeInTheDocument();
    }
    const attendance = within(grid).getByRole('group', { name: 'Attendance' });
    const { crowd } = galleryOwnBoxOffice;
    expect(
      within(attendance).getByText(
        `${String(crowd.percentFull)}% full · Harrowmere Arena, capacity 17,500`,
      ),
    ).toBeInTheDocument();
    // One worker's 2.5% of the gate came off the tickets.
    expect(within(grid).getByText(/a ticket · .* to workers$/)).toBeInTheDocument();
    expect(screen.queryByText(BOX_OFFICE_TEXT.private)).toBeNull();
    expect(screen.queryByText(BOX_OFFICE_TEXT.loss)).toBeNull();
  });

  it("draws a rival's show as its attendance only, with no money", () => {
    const grid = renderKpis(galleryRivalBoxOffice);
    expect(within(grid).getAllByRole('group')).toHaveLength(1);
    expect(within(grid).getByRole('group', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByText(BOX_OFFICE_TEXT.private)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\$/u);
  });

  it('marks a negative net as a loss', () => {
    const grid = renderKpis(galleryLossBoxOffice);
    const net = within(grid).getByRole('group', { name: 'Net' });
    expect(within(net).getByText(BOX_OFFICE_TEXT.loss)).toBeInTheDocument();
    expect(galleryLossBoxOffice.money?.net.amount ?? 0).toBeLessThan(0);
  });

  it("opens the attendance Why? with the night's roll and the venue's capacity", async () => {
    const grid = renderKpis(gallerySoldOutBoxOffice);
    expect(gallerySoldOutBoxOffice.crowd.percentFull).toBe(100);
    const user = userEvent.setup({ delay: null });
    await user.click(within(grid).getByRole('button', { name: /^Why is Attendance at Altitude/ }));
    const panel = await screen.findByRole('dialog', { name: 'Attendance' });
    expect(within(panel).getAllByText(/Crowd on the night/).length).toBeGreaterThan(0);
    expect(within(panel).getAllByText(/Capacity of Harrowmere Arena/).length).toBeGreaterThan(0);
  });
});

/** A results page's view, owned or not, run or not. */
function viewWith(mine: boolean, status: ShowResultsView['status']): ShowResultsView {
  return { ...aftermathShow(), mine, status };
}

describe('the Box office results section', () => {
  it('is registered as "Box office" between the workers (30) and the Show money (60)', () => {
    const sections = listResultsSections();
    const index = sections.findIndex((entry) => entry.id === BOX_OFFICE_SECTION_ID);
    expect(sections[index]?.label).toBe('Box office');
    expect(BOX_OFFICE_SECTION_ORDER).toBe(35);
    expect(sections.slice(0, index).every((entry) => entry.order <= 35)).toBe(true);
    expect(sections.slice(index + 1).every((entry) => entry.order >= 35)).toBe(true);
  });

  it("draws for any show that has run, the player's or a rival's, and for no other", () => {
    expect(showsBoxOffice(viewWith(true, 'completed'))).toBe(true);
    expect(showsBoxOffice(viewWith(false, 'completed'))).toBe(true);
    expect(showsBoxOffice(viewWith(true, 'scheduled'))).toBe(false);
    const section = listResultsSections().find((entry) => entry.id === BOX_OFFICE_SECTION_ID);
    const eventInstanceId = parseId('eventInstance', 'evi_0000000001');
    expect(section?.render({ eventInstanceId, view: viewWith(true, 'scheduled') })).toBeNull();
  });

  it(
    'draws a settled show from the real engine on its results page, money from its ledger rows',
    { timeout: 30_000 },
    async () => {
      const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
      const install = transport.host.installEngine(fakeEngineState());
      useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
      const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
        initialEntries: [routes.game.showResults(parseId('eventInstance', 'evi_0000000001'))],
        future: routerFutureFlags,
      });
      render(
        <EngineProvider createTransport={() => transport}>
          <RouterProvider router={router} future={routerProviderFutureFlags} />
        </EngineProvider>,
      );
      const section = await screen.findByRole(
        'region',
        { name: 'Box office' },
        { timeout: LOAD_MS },
      );
      const grid = await within(section).findByRole(
        'group',
        { name: 'Box office for Test Weekly' },
        { timeout: LOAD_MS },
      );
      const attendance = within(grid).getByRole('group', { name: 'Attendance' });
      expect(within(attendance).getByText('2,800')).toBeInTheDocument();
      for (const label of MONEY_CARDS) {
        expect(within(grid).getByRole('group', { name: label })).toBeInTheDocument();
      }
      // The tiny world's show was written straight into the save, so no breakdown was ever kept.
      expect(within(grid).getAllByText('Breakdown no longer kept')).toHaveLength(5);
    },
  );
});
