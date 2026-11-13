/**
 * The results page in the real route tree, against the test engine in process. The tiny world has
 * last Thursday's completed show, `evi_0000000001`, with four rated segments: a pre-show match,
 * then the opener, a promo and the heavyweight title match (retained) on the main card.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { EngineState } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { bookingFakeState, fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { resetSettingsForTest } from '@/test/settings';
import { registerResultsSection } from './resultsSectionRegistry';

const SHOW = parseId('eventInstance', 'evi_0000000001');

/** The lazily loaded page and the engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  resetSettingsForTest();
  useSessionStore.getState().clear();
});

function renderAt(path: string, transport: InProcessTransport) {
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return router;
}

function loadedTransport(state: EngineState = fakeEngineState()): InProcessTransport {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  return transport;
}

function renderResults(path: string = routes.game.showResults(SHOW)) {
  const transport = loadedTransport();
  const router = renderAt(path, transport);
  return { router, transport, user: userEvent.setup({ delay: null }) };
}

/** Every segment card, in page order. */
function cards(): HTMLElement[] {
  return screen.getAllByRole('article');
}

async function findHeading(): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name: 'Test Weekly' }, { timeout: LOAD_MS });
}

describe('ShowResultsScreen', () => {
  it('shows the header, the final score and every segment in card order, with no minutes', async () => {
    renderResults();
    await findHeading();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    const score = screen.getByRole('group', { name: 'Final score' });
    expect(within(score).getByText('Score')).toBeInTheDocument();
    expect(within(score).getByText('62')).toBeInTheDocument();
    expect(within(score).getByRole('img', { name: /out of 5|No stars/ })).toBeInTheDocument();
    // Attendance and viewers are stored on the tiny world's show, so both are on the bug.
    expect(within(score).getByText('Attendance')).toBeInTheDocument();
    expect(within(score).getByText('Viewers')).toBeInTheDocument();

    expect(cards().map((card) => card.getAttribute('aria-labelledby') !== null)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(
      cards().map((card) => within(card).getAllByRole('heading')[0]?.getAttribute('aria-label')),
    ).toEqual(['Slot 1: Pre-show', 'Slot 1: Opener', 'Slot 2: Midcard', 'Slot 3: Midcard']);

    const preShow = screen.getByRole('region', { name: 'Pre-show' });
    const mainCard = screen.getByRole('region', { name: 'Main card' });
    expect(within(preShow).getAllByRole('article')).toHaveLength(1);
    expect(within(mainCard).getAllByRole('article')).toHaveLength(3);
    expect(within(mainCard).getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);

    const main = screen.getByRole('main');
    expect(main.textContent).not.toMatch(RUNNING_TIME_WORDS);
    // Everything is out at once: no reveal was asked for.
    expect(screen.queryByText(/^Coming up:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  });

  it('opens with the show report: verdict, best and worst segment, and what changed', async () => {
    renderResults();
    await findHeading();
    const report = screen.getByRole('region', { name: 'Show report' });
    expect(within(report).getByText(/^A \w+ show: 62, /)).toBeInTheDocument();
    expect(
      within(report).getByRole('list', { name: 'Best and worst segment' }),
    ).toBeInTheDocument();
    const changed = within(report).getByRole('region', { name: 'What changed' });
    expect(within(changed).getByText('Title defence')).toBeInTheDocument();
    expect(within(changed).getByText(/people appeared$/)).toBeInTheDocument();
    // The report comes before the card.
    const firstCard = cards()[0];
    expect(firstCard).toBeDefined();
    if (firstCard !== undefined) {
      expect(
        report.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(firstCard.id).toMatch(/^segment-seg_/);
    }
  });

  it('marks the title match as retained and links names to profiles', async () => {
    renderResults();
    await findHeading();
    const titleMatch = cards().at(-1);
    if (titleMatch === undefined) throw new Error('No title match card.');
    expect(within(titleMatch).getByText('Retained')).toBeInTheDocument();
    const [firstLink] = within(titleMatch).getAllByRole('link');
    expect(firstLink?.getAttribute('href')).toMatch(/^\/game\/workers\/per_/);
  });

  it('plays the reveal with ?reveal=1: cards start hidden, Show all brings everything out', async () => {
    const { router, user } = renderResults(routes.game.showResults(SHOW, { reveal: true }));
    await findHeading();

    expect(screen.getAllByText(/^Coming up:/)).toHaveLength(4);
    const scoreBug = screen.getByRole('group', { name: 'Final score' });
    expect(within(scoreBug).queryByText('62')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Test section' })).toBeNull();
    // The report would give the results away, so it waits for the reveal.
    expect(screen.queryByRole('region', { name: 'Show report' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Next segment' }));
    expect(screen.getAllByText(/^Coming up:/)).toHaveLength(3);

    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.queryByText(/^Coming up:/)).toBeNull();
    expect(within(scoreBug).getByText('62')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Show report' })).toBeInTheDocument();
    // The reveal is over: a reload must not play it again.
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    expect(router.state.location.pathname).toBe(routes.game.showResults(SHOW));
  });

  it('plays the reveal again when a reveal link is followed from the page itself', async () => {
    const { router } = renderResults();
    await findHeading();
    expect(screen.queryByText(/^Coming up:/)).toBeNull();

    await act(async () => {
      await router.navigate(routes.game.showResults(SHOW, { reveal: true }));
    });
    expect(screen.getAllByText(/^Coming up:/)).toHaveLength(4);
  });

  it('waits for a tap: Next reveals one card at a time, then the score, and keeps focus', async () => {
    const { user } = renderResults(routes.game.showResults(SHOW, { reveal: true }));
    await findHeading();
    expect(screen.getAllByText(/^Coming up:/)).toHaveLength(4);

    // Nothing comes out on its own.
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
    expect(screen.getAllByText(/^Coming up:/)).toHaveLength(4);

    const next = screen.getByRole('button', { name: 'Next segment' });
    next.focus();
    const live = document.querySelector('[aria-live="polite"]');
    for (let remaining = 3; remaining >= 0; remaining -= 1) {
      await user.keyboard('{Enter}');
      expect(screen.queryAllByText(/^Coming up:/)).toHaveLength(remaining);
      expect(live?.textContent).toMatch(/^(Pre-show|Opener|Midcard)/);
    }
    // Every card is out; the score and the report still wait for one more tap.
    const scoreBug = screen.getByRole('group', { name: 'Final score' });
    expect(within(scoreBug).queryByText('62')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Show report' })).toBeNull();
    const finale = screen.getByRole('button', { name: 'Show score' });
    expect(finale).toHaveFocus();

    await user.keyboard(' ');
    expect(within(scoreBug).getByText('62')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Show report' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(live?.textContent).toMatch(/^Midcard: .+ wins? by .+\. Final score 62/);
    // The reveal buttons went with focus on them: focus moves to the show's name.
    expect(document.activeElement?.closest('h1')).not.toBeNull();
  });

  it('reveals the next card when its placeholder is tapped, and only that one', async () => {
    renderResults(routes.game.showResults(SHOW, { reveal: true }));
    await findHeading();
    const [first, second] = cards();
    if (first === undefined || second === undefined) throw new Error('Missing cards.');
    expect(first).toHaveAttribute('data-state', 'hidden');

    // The tap target is the placeholder's own cover, outside the accessibility tree.
    const cover = first.parentElement?.querySelector('button[aria-hidden="true"]');
    if (!(cover instanceof HTMLButtonElement)) throw new Error('No tap target on the next card.');
    expect(second.parentElement?.querySelector('button[aria-hidden="true"]')).toBeNull();
    fireEvent.click(cover);
    expect(first).toHaveAttribute('data-state', 'revealed');
    expect(second).toHaveAttribute('data-state', 'hidden');
    expect(second.parentElement?.querySelector('button[aria-hidden="true"]')).not.toBeNull();
  });

  it('opens fully revealed with ?reveal=1 when the one-at-a-time setting is off', async () => {
    useSettingsStore.getState().update({ revealOneAtATime: false });
    const { router } = renderResults(routes.game.showResults(SHOW, { reveal: true }));
    await findHeading();
    expect(screen.queryByText(/^Coming up:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next segment' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Show report' })).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
  });

  it('shows everything at once under reduced motion, even with ?reveal=1', async () => {
    useSettingsStore.getState().update({ reducedMotion: 'on' });
    renderResults(routes.game.showResults(SHOW, { reveal: true }));
    await findHeading();
    expect(screen.queryByText(/^Coming up:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next segment' })).toBeNull();
    expect(
      within(screen.getByRole('group', { name: 'Final score' })).getByText('62'),
    ).toBeVisible();
  });

  it('draws registered sections under the card, in order, and leaves out a null one', async () => {
    cleanups.push(
      registerResultsSection({
        id: 'test.second',
        label: 'Second section',
        order: 20,
        render: () => <p>Second body</p>,
      }),
      registerResultsSection({
        id: 'test.first',
        label: 'Test section',
        order: 10,
        render: ({ view }) => <p>{`Section for ${view.name}`}</p>,
      }),
      registerResultsSection({ id: 'test.empty', label: 'Empty', order: 5, render: () => null }),
    );
    renderResults();
    await findHeading();
    const first = screen.getByRole('region', { name: 'Test section' });
    expect(first).toHaveTextContent('Section for Test Weekly');
    expect(screen.queryByRole('region', { name: 'Empty' })).toBeNull();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    expect(headings.indexOf('Main card')).toBeLessThan(headings.indexOf('Test section'));
    expect(headings.indexOf('Test section')).toBeLessThan(headings.indexOf('Second section'));
  });

  it('says an unknown show does not exist and links to the calendar', async () => {
    renderResults(routes.game.showResults(parseId('eventInstance', 'evi_0000009999')));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Show not found' },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("That show doesn't exist")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the calendar' })).toHaveAttribute(
      'href',
      routes.game.calendar(),
    );
  });

  it('treats an address that is not a show as not found', async () => {
    renderResults('/game/event-history/not-a-show');
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Show not found' },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
  });

  it("says one of your shows hasn't run yet and offers to book it", async () => {
    const transport = loadedTransport(bookingFakeState().state);
    await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
    const shows = await transport.host.query('booking.shows', {});
    if (!shows.result.ok) throw new Error('booking.shows was refused.');
    const show = shows.result.data.rows[0];
    if (show === undefined) throw new Error('The booking world has no show.');

    const router = renderAt(routes.game.showResults(show.eventInstanceId), transport);
    await screen.findByRole('heading', { level: 1, name: show.name }, { timeout: LOAD_MS });
    expect(screen.getByText("This show hasn't run yet")).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Final score' })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Book this show' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(routes.game.booking());
    });
    expect(router.state.location.search).toContain(show.eventInstanceId);
  });

  it('says why when no game is loaded', async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    useSessionStore.getState().setLoaded({
      saveSlotId: null,
      seat: {
        viewer: { kind: 'controller', controller: { kind: 'human', playerId: 'dev' } },
        controller: { kind: 'human', playerId: 'dev' },
        promotionId: null,
      },
    });
    renderAt(routes.game.showResults(SHOW), transport);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Show results' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByText("The results can't be shown")).toBeInTheDocument();
    expect(screen.getByText('No game is loaded')).toBeInTheDocument();
  });
});
