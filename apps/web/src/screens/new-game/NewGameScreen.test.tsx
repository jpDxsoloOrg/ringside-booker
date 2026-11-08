import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NewGameSettingDef,
  NewGameSummary,
  PackManifest,
  WorldPreview,
} from '@ringside/engine';
import { packManifestSchema, parseGameDate, parseId } from '@ringside/engine';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import type { StartNewGameInput } from '@/worker/engineHost';
import { NewGameScreen } from './NewGameScreen';
import { emptyFoundForm, REMEMBERED_CHOICES_KEY, useNewGameDraft } from './useNewGameDraft';
import type { NewGameEngine, StartOutcome, StartPhase } from './useNewGameEngine';

const WORLD_ID = 'test-world';

const TEST_SETTING: NewGameSettingDef = {
  key: 'testRivalryRule',
  kind: 'boolean',
  default: false,
  label: 'Test rivalry rule',
  description: 'Registered by the test to prove settings come from the preview.',
  group: 'difficulty',
};

const MANIFEST: PackManifest = packManifestSchema.parse({
  formatVersion: 1,
  id: WORLD_ID,
  name: 'Test World',
  version: '1.0.0',
  kind: 'world',
  description: 'A small world for the wizard tests.',
  author: 'Tests',
  dependsOn: [],
  startDate: '2027-01-04',
  files: {},
});

const PREVIEW: WorldPreview = {
  manifest: MANIFEST,
  startDate: parseGameDate('2027-01-04'),
  promotions: [
    {
      key: 'harbour-city',
      name: 'Harbour City Wrestling',
      shortName: 'HCW',
      color: '#1f6f8b',
      homeRegion: { key: 'harbour-coast', name: 'Harbour Coast' },
      homeCountry: { key: 'cormere', name: 'Cormere' },
      style: 'traditional',
      cash: 25_000_000,
      prestige: 38,
      rosterSize: 12,
      titleCount: 2,
      homeCountryPopularity: 31.5,
      regionsKnownIn: 2,
      brands: [{ key: 'hcw-friday', name: 'Friday Night Harbour' }],
    },
    {
      key: 'river-city',
      name: 'River City Wrestling',
      shortName: 'RCW',
      color: '#8b1f3a',
      homeRegion: { key: 'river-valley', name: 'River Valley' },
      homeCountry: { key: 'cormere', name: 'Cormere' },
      style: 'hardHitting',
      cash: 9_000_000,
      prestige: 20,
      rosterSize: 8,
      titleCount: 1,
      homeCountryPopularity: 12,
      regionsKnownIn: 1,
      brands: [],
    },
  ],
  topWorkers: [
    {
      key: 'per-ace',
      ringName: 'Harbour Ace',
      promotionShortName: 'HCW',
      age: 31,
      style: 'technician',
      popularitySummary: {
        bestCountry: { key: 'cormere', name: 'Cormere' },
        bestCountryPopularity: 44,
        regionsKnownIn: 2,
      },
    },
  ],
  peopleCount: 42,
  regions: [
    {
      key: 'north',
      name: 'Northland',
      countries: [
        {
          key: 'cormere',
          name: 'Cormere',
          regions: [
            { key: 'harbour-coast', name: 'Harbour Coast', population: 2_000_000 },
            { key: 'river-valley', name: 'River Valley', population: 1_000_000 },
          ],
        },
      ],
    },
  ],
  settings: [
    {
      key: 'agingEnabled',
      kind: 'boolean',
      default: true,
      label: 'Aging',
      description: 'People age and skills follow age curves.',
      group: 'world',
    },
    {
      key: 'generationLevel',
      kind: 'enum',
      options: ['off', 'low', 'medium', 'high'],
      default: 'low',
      label: 'New content',
      description: 'How much new content appears over time.',
      group: 'world',
    },
    TEST_SETTING,
  ],
  seasonLength: {
    presets: [
      { key: '1m', label: '1 month', lengthDays: 28 },
      { key: '3m', label: '3 months', lengthDays: 91 },
      { key: '6m', label: '6 months', lengthDays: 182 },
      { key: '12m', label: '12 months', lengthDays: 364 },
    ],
    defaultPreset: '6m',
    customWeeks: { min: 4, max: 104 },
  },
  foundingSizes: {
    small: { cash: 7_500_000, homePopularity: 8, countryPopularity: 2, prestige: 20 },
    medium: { cash: 30_000_000, homePopularity: 20, countryPopularity: 8, prestige: 35 },
    large: { cash: 120_000_000, homePopularity: 35, countryPopularity: 18, prestige: 50 },
  },
  takenShortNames: ['HCW', 'RCW'],
  takenNames: ['Harbour City Wrestling', 'River City Wrestling'],
};

const SUMMARY: NewGameSummary = {
  saveName: 'HCW 2027',
  playerName: 'Alex Booker',
  playerId: 'local',
  startDate: parseGameDate('2027-01-04'),
  season: {
    number: 1,
    startDate: parseGameDate('2027-01-04'),
    endDate: parseGameDate('2027-07-04'),
    lengthDays: 182,
  },
  promotion: {
    id: parseId('promotion', 'pro_00000000ab'),
    name: 'Harbour City Wrestling',
    shortName: 'HCW',
    cash: 25_000_000,
  },
  counts: { promotions: 2, people: 42, freeAgents: 10, titles: 3 },
  settings: {},
  packVersions: [],
};

type StartFn = NewGameEngine['start'];

const engineMock = vi.hoisted(() => ({
  start: vi.fn<StartFn>(),
  retrySave: vi.fn<NewGameEngine['retrySave']>(),
}));

vi.mock('./useNewGameEngine', () => ({
  useNewGameEngine: (rootPackId: string | null): NewGameEngine => ({
    worlds: { status: 'ready', packs: [MANIFEST], issues: [] },
    preview:
      rootPackId === WORLD_ID
        ? { status: 'ready', rootPackId, preview: PREVIEW }
        : { status: 'idle' },
    start: engineMock.start,
    retrySave: engineMock.retrySave,
  }),
}));

function renderWizard(path: string = routes.newGame()) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <LiveAnnouncer>
            <Outlet />
          </LiveAnnouncer>
        ),
        children: [
          { path: routes.newGame(), element: <NewGameScreen /> },
          { path: routes.game.office(), element: <h1>Office</h1> },
          { path: routes.title(), element: <h1>Title</h1> },
        ],
      },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return router;
}

async function expectStepHeading(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name });
  return heading;
}

/** A draft ready to start: the test world, Harbour City Wrestling, every default. */
function chooseExistingPromotion(): void {
  useNewGameDraft.setState({
    rootPackId: WORLD_ID,
    player: { mode: 'existing', promotionKey: 'harbour-city', found: emptyFoundForm() },
    playerName: 'Alex Booker',
    seed: 'test-seed',
    dirty: true,
  });
}

beforeEach(() => {
  window.localStorage.removeItem(REMEMBERED_CHOICES_KEY);
  useNewGameDraft.getState().reset();
  engineMock.start.mockReset();
  engineMock.retrySave.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NewGameScreen', () => {
  it('chooses the only world by itself and shows what is in it', async () => {
    renderWizard();

    expect(await screen.findByRole('heading', { level: 1, name: 'New game' })).toBeInTheDocument();
    await expectStepHeading('Choose a world');
    const world = await screen.findByRole('radio', { name: /Test World/ });
    await waitFor(() => {
      expect(world).toBeChecked();
    });
    expect(screen.getByText('42')).toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'New game steps' });
    expect(within(rail).getByText('World').closest('li')).toHaveAttribute('aria-current', 'step');
    // The automatic pick is not an edit, so leaving would not ask.
    expect(useNewGameDraft.getState().dirty).toBe(false);
  });

  it('lets Next move on once a promotion is chosen, and moves focus to the step heading', async () => {
    const user = userEvent.setup();
    const router = renderWizard();
    await waitFor(() => {
      expect(useNewGameDraft.getState().rootPackId).toBe(WORLD_ID);
    });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    const heading = await expectStepHeading('Choose your promotion');
    expect(heading).toHaveFocus();
    expect(router.state.location.search).toBe('?step=2');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByText('Choose a promotion to run, or found your own.'),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe('?step=2');

    await user.click(screen.getByRole('row', { name: /River City Wrestling/ }));
    expect(screen.queryByText('Choose a promotion to run, or found your own.')).toBeNull();
    expect(screen.getByRole('heading', { name: 'About River City Wrestling' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await expectStepHeading('Game options');
    expect(router.state.location.search).toBe('?step=3');
  });

  it('rejects a short name another promotion has, as it is typed', async () => {
    const user = userEvent.setup();
    renderWizard('/new?step=2');
    await expectStepHeading('Choose your promotion');

    await user.click(await screen.findByRole('button', { name: 'Found your own promotion' }));
    const shortName = screen.getByRole('textbox', { name: 'Short name' });
    await user.type(shortName, 'hcw');

    expect(screen.getByText('HCW is already taken by another promotion.')).toBeInTheDocument();
    expect(shortName).toHaveAttribute('aria-invalid', 'true');

    await user.clear(shortName);
    await user.type(shortName, 'tbw');
    expect(screen.queryByText(/already taken/)).toBeNull();
    expect(shortName).not.toHaveAttribute('aria-invalid');
  });

  it('renders every setting the preview registers, including one added by a test', async () => {
    chooseExistingPromotion();
    renderWizard('/new?step=3');
    await expectStepHeading('Game options');

    const testSwitch = screen.getByRole('switch', { name: 'Test rivalry rule' });
    expect(testSwitch).toHaveAccessibleDescription(TEST_SETTING.description);
    expect(testSwitch).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Aging' })).toBeChecked();
    expect(screen.getByRole('group', { name: 'New content' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Low' })).toBeChecked();
    expect(screen.getByRole('heading', { level: 3, name: 'Difficulty' })).toBeInTheDocument();
  });

  it('defaults the season to the preview’s preset, blocks a 3-week custom season and sends the chosen length', async () => {
    const user = userEvent.setup();
    chooseExistingPromotion();
    engineMock.start.mockResolvedValue({ kind: 'refused', reasons: [] });
    const router = renderWizard('/new?step=3');
    await expectStepHeading('Game options');

    const seasonGroup = screen.getByRole('group', { name: 'Season length' });
    expect(within(seasonGroup).getByRole('radio', { name: '6 months' })).toBeChecked();
    expect(screen.getByTestId('season-one-line')).toHaveTextContent(
      'Season 1 runs Jan 4, 2027 – Jul 4, 2027 (182 days)',
    );

    await user.click(within(seasonGroup).getByRole('radio', { name: 'Custom' }));
    const weeks = screen.getByRole('spinbutton', { name: 'Season length in weeks' });
    await user.clear(weeks);
    await user.type(weeks, '3');
    expect(screen.getByText('Enter a whole number of weeks from 4 to 104.')).toBeInTheDocument();
    expect(weeks).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(router.state.location.search).toBe('?step=3');

    await user.clear(weeks);
    await user.type(weeks, '10');
    // The field's own error is gone (the live region may still be reading the old one out).
    expect(weeks).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('season-one-line')).toHaveTextContent('(70 days)');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await expectStepHeading('Review and start');
    await user.click(screen.getByRole('button', { name: 'Start game' }));

    await waitFor(() => {
      expect(engineMock.start).toHaveBeenCalledTimes(1);
    });
    const input: StartNewGameInput | undefined = engineMock.start.mock.calls[0]?.[0];
    expect(input?.seasonLength).toEqual({ customWeeks: 10 });
    expect(input?.player).toEqual({ mode: 'existing', promotionKey: 'harbour-city' });
    expect(input?.saveName).toBe('HCW 2027');
  });

  it('sends the player back to the short name when the engine says it is taken', async () => {
    const user = userEvent.setup();
    useNewGameDraft.setState({
      rootPackId: WORLD_ID,
      player: {
        mode: 'found',
        promotionKey: null,
        found: {
          ...emptyFoundForm(),
          name: 'Zenith Wrestling',
          shortName: 'ZEN',
          continentKey: 'north',
          countryKey: 'cormere',
          homeRegionKey: 'harbour-coast',
          style: 'technical',
        },
      },
      playerName: 'Alex Booker',
      seed: 'test-seed',
      dirty: true,
    });
    engineMock.start.mockResolvedValue({
      kind: 'refused',
      reasons: [
        {
          code: 'shortNameTaken',
          message: 'ZEN is already the short name of Zenith Pro.',
          field: 'player.shortName',
        },
      ],
    });
    const router = renderWizard('/new?step=4');
    await expectStepHeading('Review and start');

    await user.click(screen.getByRole('button', { name: 'Start game' }));

    await expectStepHeading('Choose your promotion');
    expect(router.state.location.search).toBe('?step=2');
    expect(screen.getByRole('textbox', { name: 'Short name' })).toHaveAccessibleDescription(
      expect.stringContaining('ZEN is already the short name of Zenith Pro.'),
    );
    await waitFor(() => {
      expect(
        screen
          .getAllByRole('status')
          .some((region) => region.textContent.includes('1 problem to fix on the Promotion step')),
      ).toBe(true);
    });
  });

  it('shows a refusal no field owns at the top of its step', async () => {
    const user = userEvent.setup();
    chooseExistingPromotion();
    engineMock.start.mockResolvedValue({
      kind: 'refused',
      reasons: [{ code: 'packIssue', message: 'people.json in test-world is not valid.' }],
    });
    const router = renderWizard('/new?step=4');
    await expectStepHeading('Review and start');

    await user.click(screen.getByRole('button', { name: 'Start game' }));

    await expectStepHeading('Choose a world');
    expect(router.state.location.search).toBe('?step=1');
    expect(screen.getByTestId('step-issues')).toHaveTextContent(
      'people.json in test-world is not valid.',
    );
  });

  it('shows the busy state while the game is built, then opens the office', async () => {
    const user = userEvent.setup();
    chooseExistingPromotion();
    let finish: (outcome: StartOutcome) => void = () => undefined;
    engineMock.start.mockImplementation(
      (_input: StartNewGameInput, onPhase: (phase: StartPhase) => void) => {
        onPhase('creating');
        return new Promise<StartOutcome>((resolve) => {
          finish = resolve;
        });
      },
    );
    const router = renderWizard('/new?step=4');
    await expectStepHeading('Review and start');

    await user.click(screen.getByRole('button', { name: 'Start game' }));

    expect(await screen.findByText('Building the world…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start game' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await act(async () => {
      finish({ kind: 'started', summary: SUMMARY, slotId: 'slot-1' });
      await Promise.resolve();
    });

    expect(await screen.findByRole('heading', { level: 1, name: 'Office' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.game.office());
    // The choices are remembered for the next new game, and the draft starts fresh.
    expect(window.localStorage.getItem(REMEMBERED_CHOICES_KEY)).toContain('Alex Booker');
    expect(useNewGameDraft.getState().dirty).toBe(false);
  });

  it('asks before leaving with a draft, and leaves without asking when nothing changed', async () => {
    const user = userEvent.setup();
    chooseExistingPromotion();
    renderWizard('/new?step=2');
    await expectStepHeading('Choose your promotion');

    await user.click(screen.getByRole('link', { name: 'Main menu' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave the new game?' });
    await user.click(within(dialog).getByRole('button', { name: 'Keep setting up' }));
    expect(
      screen.getByRole('heading', { level: 2, name: 'Choose your promotion' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Main menu' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave' }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    expect(useNewGameDraft.getState().dirty).toBe(false);
  });

  it('shows an unexpected failure in a dismissible panel with its details to copy', async () => {
    const user = userEvent.setup();
    chooseExistingPromotion();
    engineMock.start.mockResolvedValue({
      kind: 'error',
      message: 'The engine did not answer',
      details: 'Error: The engine did not answer\n    at start',
    });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWizard('/new?step=4');
    await expectStepHeading('Review and start');

    await user.click(screen.getByRole('button', { name: 'Start game' }));
    const title = await screen.findByText('The game could not be started');
    const panel = title.closest<HTMLElement>('[role="alert"]');
    if (panel === null) throw new Error('The failure panel is not an alert');
    expect(panel).toHaveTextContent('The engine did not answer');
    await user.click(within(panel).getByRole('button', { name: 'Copy details' }));
    expect(writeText).toHaveBeenCalledWith('Error: The engine did not answer\n    at start');

    await user.click(within(panel).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('The game could not be started')).toBeNull();
  });
});
