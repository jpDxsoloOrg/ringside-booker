/**
 * The results page's "Show money" section (ECO1-06): the rows drawn from fixtures, the
 * registration (own completed shows only), and the section on a real results page against the
 * test engine, whose tiny world has one completed show with three ledger rows.
 */
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { parseId } from '@ringside/engine';
import type { ShowResultsView } from '@ringside/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import {
  GALLERY_SHOW_MONEY_MONTH,
  GALLERY_SHOW_MONEY_NAME,
  galleryShowMoneyRows,
} from '@/screens/dev-gallery/fixtures/showMoney';
import { aftermathShow } from '@/screens/match-aftermath/aftermathResultsFixtures';
import { listResultsSections } from '@/screens/show-results/resultsSectionRegistry';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import {
  SHOW_MONEY_SECTION_ID,
  SHOW_MONEY_SECTION_LABEL,
  SHOW_MONEY_SECTION_ORDER,
  showsShowMoney,
} from './registerShowMoney';
import { SHOW_MONEY_TEXT, ShowMoneyRows, showMoneyLedgerLinkText } from './ShowMoneySection';

const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

function renderRows() {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return render(
    <EngineProvider createTransport={() => transport}>
      <MemoryRouter future={routerFutureFlags}>
        <ShowMoneyRows
          rows={galleryShowMoneyRows}
          showName={GALLERY_SHOW_MONEY_NAME}
          month={GALLERY_SHOW_MONEY_MONTH}
        />
      </MemoryRouter>
    </EngineProvider>,
  );
}

/** A results page's view, owned or not, run or not. */
function viewWith(mine: boolean, status: ShowResultsView['status']): ShowResultsView {
  return { ...aftermathShow(), mine, status };
}

describe('ShowMoneyRows', () => {
  it('lists every row of the show with its amount, and a Why? for each row still kept', () => {
    renderRows();
    const list = screen.getByRole('list', { name: `Money for ${GALLERY_SHOW_MONEY_NAME}` });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(galleryShowMoneyRows.length);
    expect(within(list).getByText('Travel')).toBeInTheDocument();
    expect(within(list).getByText(`${GALLERY_SHOW_MONEY_NAME}: travel`)).toBeInTheDocument();
    expect(
      within(list).getByRole('button', {
        name: `Why is Travel for ${GALLERY_SHOW_MONEY_NAME} −$650?`,
      }),
    ).toBeInTheDocument();
    expect(within(list).getAllByRole('button', { name: /^Why is / })).toHaveLength(3);
    expect(within(list).getAllByText(SHOW_MONEY_TEXT.notKept)).toHaveLength(3);
  });

  it('adds up the net for the show and links to its month in the ledger', () => {
    renderRows();
    expect(screen.getByText('Net for this show')).toBeInTheDocument();
    // 84,000 + 1,000 − 15,000 − 400 − 650 − 250 = 68,700, drawn in the default compact style
    expect(screen.getByText('plus $68.7K')).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: showMoneyLedgerLinkText(GALLERY_SHOW_MONEY_MONTH),
    });
    expect(link).toHaveAttribute(
      'href',
      routes.game.finances({ tab: 'ledger', month: GALLERY_SHOW_MONEY_MONTH }),
    );
    expect(link).toHaveTextContent('See March 2027 in the ledger');
  });
});

describe('the Show money results section', () => {
  it('is registered as "Show money" after the other results sections', () => {
    const sections = listResultsSections();
    const section = sections.find((entry) => entry.id === SHOW_MONEY_SECTION_ID);
    expect(section?.label).toBe(SHOW_MONEY_SECTION_LABEL);
    expect(SHOW_MONEY_SECTION_ORDER).toBe(60);
    expect(sections.at(-1)?.id).toBe(SHOW_MONEY_SECTION_ID);
  });

  it("draws only for the viewer's own shows that have run: a rival's books are private", () => {
    expect(showsShowMoney(viewWith(true, 'completed'))).toBe(true);
    expect(showsShowMoney(viewWith(false, 'completed'))).toBe(false);
    expect(showsShowMoney(viewWith(true, 'booked'))).toBe(false);
    const section = listResultsSections().find((entry) => entry.id === SHOW_MONEY_SECTION_ID);
    const eventInstanceId = parseId('eventInstance', 'evi_0000000001');
    expect(section?.render({ eventInstanceId, view: viewWith(false, 'completed') })).toBeNull();
  });

  it("lists the show's ledger rows under the card of a real results page", async () => {
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
    const section = await screen.findByRole('region', { name: 'Show money' }, { timeout: LOAD_MS });
    const list = await within(section).findByRole(
      'list',
      { name: 'Money for Test Weekly' },
      { timeout: LOAD_MS },
    );
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    for (const label of ['Tickets', 'TV rights', 'Venue rent']) {
      expect(within(list).getByText(label)).toBeInTheDocument();
    }
    expect(
      within(section).getByRole('link', { name: 'See April 2026 in the ledger' }),
    ).toHaveAttribute('href', routes.game.finances({ tab: 'ledger', month: '2026-04' }));
  });
});
