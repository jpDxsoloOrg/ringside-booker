import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { PersonId, PromotionId, StorylineId } from '@ringside/engine';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routePatterns, routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { StorylineDetailScreen, STORYLINE_NOT_FOUND_TITLE } from './StorylineDetailScreen';
import { StorylinesScreen } from './StorylinesScreen';

/** The `index`-th element, or a failed test. */
function nth(elements: readonly HTMLElement[], index: number): HTMLElement {
  const element = elements[index];
  if (element === undefined) throw new Error(`No element at ${String(index)}`);
  return element;
}

/** The engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

/** The tiny world's storyline: Test Promotion A's, heat 60, a face and a heel, 2 linked segments. */
const TINY_STORYLINE = 'Test Storyline A';

interface Rendered {
  readonly router: ReturnType<typeof createMemoryRouter>;
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly transport: InProcessTransport;
  readonly promotionId: PromotionId;
}

/** Both storyline screens on their own routes (no app shell), over the tiny world. */
function renderStorylines(path: string = routes.game.storylines()): Rendered {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  const promotionId = install.seat.promotionId;
  if (promotionId === null) throw new Error('The tiny world seats the player at a promotion');
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(
    [
      {
        path: routes.game.storylines(),
        element: (
          <LiveAnnouncer>
            <StorylinesScreen />
          </LiveAnnouncer>
        ),
      },
      {
        path: routePatterns.storyline,
        element: (
          <LiveAnnouncer>
            <StorylineDetailScreen />
          </LiveAnnouncer>
        ),
      },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, user: userEvent.setup({ delay: null }), transport, promotionId };
}

async function storylineIdNamed(transport: InProcessTransport, name: string): Promise<StorylineId> {
  const { result } = await transport.host.query('storylines.list', { status: 'all' });
  if (!result.ok) throw new Error('storylines.list refused');
  const row = result.data.rows.find((candidate) => candidate.name === name);
  if (row === undefined) throw new Error(`No storyline called ${name}`);
  return row.id;
}

async function rosterIds(transport: InProcessTransport): Promise<PersonId[]> {
  const { result } = await transport.host.query('storylines.memberOptions', {});
  if (!result.ok) throw new Error('storylines.memberOptions refused');
  return result.data.options.map((option) => option.personId);
}

async function findCard(name: string): Promise<HTMLElement> {
  return screen.findByRole('article', { name }, { timeout: LOAD_MS });
}

async function openPage(rendered: Rendered, name: string): Promise<HTMLElement> {
  const id = await storylineIdNamed(rendered.transport, name);
  await rendered.router.navigate(routes.game.storyline(id));
  return screen.findByRole('heading', { level: 1, name }, { timeout: LOAD_MS });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  useTracePanelStore.setState({ openPanelId: null });
});

describe('StorylinesScreen', () => {
  it('lists the storyline as a card with its face against its heel and a heat meter', async () => {
    renderStorylines();
    expect(screen.getByRole('heading', { level: 1, name: 'Storylines' })).toBeInTheDocument();
    const card = await findCard(TINY_STORYLINE);
    expect(
      within(within(card).getByRole('list', { name: 'Faces' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(
      within(within(card).getByRole('list', { name: 'Heels' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(within(card).getByRole('meter', { name: 'Heat' })).toHaveAttribute(
      'aria-valuenow',
      '60',
    );
    expect(within(card).getByText(/2 linked segments/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Active/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('starts a storyline through the sheet, opens its page and lists its card', async () => {
    const rendered = renderStorylines();
    const { user } = rendered;
    await findCard(TINY_STORYLINE);
    await user.click(nth(screen.getAllByRole('button', { name: 'New storyline' }), 0));
    const sheet = await screen.findByRole('dialog', { name: 'New storyline' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Name' }), 'Test New Feud');
    const addButtons = await within(sheet).findAllByRole(
      'button',
      { name: /^Add / },
      { timeout: LOAD_MS },
    );
    await user.click(nth(addButtons, 2));
    await user.click(nth(addButtons, 3));
    expect(within(sheet).getByText('2 of 12')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Start storyline' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Test New Feud' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    await rendered.router.navigate(routes.game.storylines());
    expect(await findCard('Test New Feud')).toBeInTheDocument();
  });

  it('shows a taken name under the name field, in the engine’s words', async () => {
    const { user } = renderStorylines();
    await findCard(TINY_STORYLINE);
    await user.click(nth(screen.getAllByRole('button', { name: 'New storyline' }), 0));
    const sheet = await screen.findByRole('dialog', { name: 'New storyline' });
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.type(name, TINY_STORYLINE);
    const addButtons = await within(sheet).findAllByRole(
      'button',
      { name: /^Add / },
      { timeout: LOAD_MS },
    );
    await user.click(nth(addButtons, 4));
    await user.click(within(sheet).getByRole('button', { name: 'Start storyline' }));

    await waitFor(() => {
      expect(name).toHaveAccessibleDescription(
        expect.stringContaining(`You already run a storyline called ${TINY_STORYLINE}.`),
      );
    });
    expect(name).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('StorylineDetailScreen', () => {
  it("links each member's name on the page to their profile (CRTV3-05)", async () => {
    const rendered = renderStorylines();
    await openPage(rendered, TINY_STORYLINE);
    const id = await storylineIdNamed(rendered.transport, TINY_STORYLINE);
    const { result } = await rendered.transport.host.query('storylines.detail', {
      storylineId: id,
    });
    if (!result.ok) throw new Error('storylines.detail refused');
    const sides = [
      ['Faces', result.data.faces],
      ['Heels', result.data.heels],
    ] as const;
    for (const [region, members] of sides) {
      for (const member of members) {
        expect(
          within(screen.getByRole('region', { name: region })).getByRole('link', {
            name: member.name,
          }),
        ).toHaveAttribute('href', routes.game.worker(member.personId));
      }
    }
  });

  it('moves a member to Heels when their side changes', async () => {
    const rendered = renderStorylines();
    const { user } = rendered;
    await openPage(rendered, TINY_STORYLINE);
    const faces = screen.getByRole('region', { name: 'Faces' });
    const face = within(faces).getByRole('button', { name: /^Actions for / });
    const name = (face.getAttribute('aria-label') ?? '').replace('Actions for ', '');
    face.focus();
    await user.keyboard('{Enter}');
    const changeSide = await screen.findByRole('menuitem', { name: 'Change side' });
    await waitFor(() => {
      expect(changeSide).toHaveFocus();
    });
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'Heel' }));

    await waitFor(
      () => {
        expect(
          within(screen.getByRole('region', { name: 'Heels' })).getByText(name),
        ).toBeInTheDocument();
      },
      { timeout: LOAD_MS },
    );
    expect(
      within(screen.getByRole('region', { name: 'Faces' })).getByText('No one yet'),
    ).toBeInTheDocument();
  });

  it('refuses to remove the last member, in the engine’s words', async () => {
    const rendered = renderStorylines();
    const { user, transport, promotionId } = rendered;
    const [only] = await rosterIds(transport);
    if (only === undefined) throw new Error('The tiny world has no roster');
    const created = await transport.host.command('storylines.create', {
      promotionId,
      name: 'Test Lone Story',
      members: [{ personId: only, side: 'face' }],
    });
    expect(created.result.ok).toBe(true);
    await openPage(rendered, 'Test Lone Story');

    await user.click(screen.getByRole('button', { name: /^Actions for / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(
      await within(dialog).findByText(
        'A storyline needs at least one person. End it instead.',
        undefined,
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
  });

  it('ends a storyline: the page shows why it paid nothing and the card moves to Ended', async () => {
    const rendered = renderStorylines();
    const { user } = rendered;
    await openPage(rendered, TINY_STORYLINE);
    await user.click(screen.getByRole('button', { name: 'End storyline' }));
    const sheet = await screen.findByRole('dialog', { name: `End ${TINY_STORYLINE}?` });
    expect(
      await within(sheet).findByText(/No payoff \(needs 4 linked segments, has 0\)/, undefined, {
        timeout: LOAD_MS,
      }),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'End storyline' }));

    expect(
      await screen.findByText('No payoff (needs 4 linked segments, had 0)', undefined, {
        timeout: LOAD_MS,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End storyline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for / })).toBeNull();

    await rendered.router.navigate(`${routes.game.storylines()}?tab=ended`);
    expect(await findCard(TINY_STORYLINE)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ended/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('says a storyline it cannot find is not found, with a way back', async () => {
    renderStorylines(routes.game.storyline(parseId('storyline', 'sty_0000009999')));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: STORYLINE_NOT_FOUND_TITLE },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Storylines' })).toHaveAttribute(
      'href',
      routes.game.storylines(),
    );
  });
});
