/**
 * CRTV4-05 on the storyline page and the results page, against the test engine: the heat
 * timeline, the finale hint, the end sheet's payoff preview and the paid record, the Sandbox-only
 * Set heat, and the results page's Storylines section. The timeline and show progress answers are
 * canned (their heat steps need a show night to exist); the payoff is the real engine's.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, defineQuery, parseId } from '@ringside/engine';
import type {
  CreateEngineOptions,
  Engine,
  EngineState,
  QueryDefinition,
  QueryName,
  StorylineId,
  StorylineShowProgress,
  StorylineTimeline,
  SystemBundle,
  TraceRef,
} from '@ringside/engine';
import { initialEngineState } from '@ringside/engine';
import { TEST_PLAYER_ID, TEST_START_DATE, worldBuilder } from '@ringside/engine/testing';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routePatterns, routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { aftermathShow } from '@/screens/match-aftermath/aftermathResultsFixtures';
import { listResultsSections } from '@/screens/show-results/resultsSectionRegistry';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { stillBookedText } from './end/payoffText';
import { finalePlayedText } from './FinaleHint';
import { StorylineDetailScreen } from './StorylineDetailScreen';
import { STORYLINES_SECTION_ID, STORYLINES_SECTION_LABEL } from './results/register';
import { lostInsideText, StorylinesResultsSection } from './results/StorylinesResultsSection';
import { BOOKED_TEXT } from './timeline/HeatTimeline';

const LOAD_MS = 10_000;
const HOT = 'Test Hot Feud';
const SHORT = 'Test Short Feud';
const COUNTED = { segments: 4, matches: 4, angles: 0, heatGained: 10, heatLost: 0 };

/** A Why? reference: the panel finds nothing behind it, which is all these tests need. */
function fakeRef(id: string): TraceRef {
  return { kind: 'storylines.heatStep', id };
}

interface HeatWorld {
  readonly state: EngineState;
  readonly hot: StorylineId;
  readonly short: StorylineId;
  readonly timeline: StorylineTimeline;
}

/**
 * The player's promotion with a fan base and four wrestlers: `Test Hot Feud` (heat 80, four counted
 * segments, its finale played on today's show) and `Test Short Feud` (heat 40, one counted, a
 * match booked on next week's show). The hot feud's canned timeline has its finale step and an
 * older step whose segment is gone.
 */
function heatWorld(sandbox = false): HeatWorld {
  const { world, ids } = worldBuilder({ settings: { sandbox } })
    .withGeography('mini')
    .withPromotion({ controller: { kind: 'human', playerId: TEST_PLAYER_ID } }, (promotion) =>
      promotion
        .withRoster(4)
        .withStoryline(
          { name: HOT, heat: 80, progressTotals: COUNTED },
          {
            members: [
              [0, 'face'],
              [1, 'heel'],
            ],
          },
        )
        .withStoryline(
          {
            name: SHORT,
            heat: 40,
            progressTotals: { ...COUNTED, segments: 1, matches: 1 },
          },
          { members: [[2, 'face']] },
        ),
    )
    .withEventInstance({ name: 'Test Show' })
    .withEventInstance({ name: 'Test Next Show', date: addDays(TEST_START_DATE, 7) })
    .withCompletedMatch({ show: 0, sides: [[0], [1]], result: 0 })
    .withCompletedMatch({ show: 1, sides: [[2], [3]], result: null, run: false })
    .with('fan base, links and the finale', ({ tx, ids: built }) => {
      const fanBase = Object.fromEntries(built.regions.map((id) => [id, 60]));
      tx.update('promotions', built.promotions.A!, { regionalPop: fanBase });
      const [hot, short] = built.storylines;
      tx.update('segments', built.segments[0]!, { storylineIds: [hot!] });
      tx.update('storylines', hot!, { finaleSegmentId: built.segments[0]! });
      tx.update('segments', built.segments[1]!, { storylineIds: [short!] });
    })
    .build();
  const hot = ids.storylines[0]!;
  const timeline: StorylineTimeline = {
    kind: 'ok',
    keptDays: 28,
    totals: COUNTED,
    rows: [
      {
        segmentId: ids.segments[0]!,
        eventInstanceId: ids.eventInstances[0]!,
        showName: 'Test Show',
        date: TEST_START_DATE,
        slot: 0,
        preShow: false,
        format: null,
        kind: 'match',
        segmentLabel: 'Finale match',
        heatBefore: 70,
        heatAfter: 80,
        traceRef: fakeRef('newest'),
        finale: true,
      },
      {
        segmentId: parseId('segment', 'seg_0000009998'),
        eventInstanceId: parseId('eventInstance', 'evi_0000009998'),
        showName: 'Test Old Show',
        date: addDays(TEST_START_DATE, -7),
        slot: 2,
        preShow: false,
        format: null,
        kind: 'match',
        segmentLabel: 'Older match',
        heatBefore: 62,
        heatAfter: 70,
        traceRef: fakeRef('older'),
        finale: false,
      },
    ],
  };
  return { state: initialEngineState(world), hot, short: ids.storylines[1]!, timeline };
}

/** The real systems, with canned answers for the named queries. */
function cannedFactory(answers: {
  readonly timeline?: (storylineId: StorylineId) => StorylineTimeline | undefined;
  readonly showProgress?: StorylineShowProgress;
}) {
  const base = fakeEngineFactory();
  const replace = <N extends QueryName>(
    systems: readonly SystemBundle[],
    replacement: QueryDefinition<N>,
  ): SystemBundle[] =>
    systems.map((system) => ({
      ...system,
      queries: system.queries.map((query) =>
        query.name === replacement.name ? replacement : query,
      ),
    }));
  return (options: CreateEngineOptions): Engine => {
    let systems = [...options.systems];
    const timelineQuery = systems
      .flatMap((system) => system.queries)
      .find(
        (query): query is QueryDefinition<'storylines.timeline'> =>
          query.name === 'storylines.timeline',
      );
    if (answers.timeline !== undefined && timelineQuery !== undefined) {
      const pick = answers.timeline;
      systems = replace(
        systems,
        defineQuery('storylines.timeline', {
          args: timelineQuery.args,
          run: (ctx, args) => pick(args.storylineId) ?? timelineQuery.run(ctx, args),
        }),
      );
    }
    const progressQuery = systems
      .flatMap((system) => system.queries)
      .find(
        (query): query is QueryDefinition<'storylines.showProgress'> =>
          query.name === 'storylines.showProgress',
      );
    if (answers.showProgress !== undefined && progressQuery !== undefined) {
      const answer = answers.showProgress;
      systems = replace(
        systems,
        defineQuery('storylines.showProgress', { args: progressQuery.args, run: () => answer }),
      );
    }
    return base({ ...options, systems });
  };
}

interface Rendered {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly transport: InProcessTransport;
}

function renderPage(world: HeatWorld, storylineId: StorylineId): Rendered {
  const factory = cannedFactory({
    timeline: (id) => (id === world.hot ? world.timeline : undefined),
  });
  const transport = createInProcessTransport(factory, { progressIntervalMs: 0 });
  const install = transport.host.installEngine(world.state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(
    [
      {
        path: routePatterns.storyline,
        element: (
          <LiveAnnouncer>
            <StorylineDetailScreen />
          </LiveAnnouncer>
        ),
      },
    ],
    { initialEntries: [routes.game.storyline(storylineId)], future: routerFutureFlags },
  );
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { user: userEvent.setup({ delay: null }), transport };
}

async function heading(name: string): Promise<HTMLElement> {
  return screen.findByRole('heading', { level: 1, name }, { timeout: LOAD_MS });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  useTracePanelStore.setState({ openPanelId: null });
});

describe('the storyline page (CRTV4-05)', () => {
  it('lists the timeline newest first with a heat chip and a Why? on each counted step', async () => {
    const world = heatWorld();
    renderPage(world, world.hot);
    await heading(HOT);
    const timeline = await screen.findByRole(
      'list',
      { name: 'Linked segments, newest first' },
      { timeout: LOAD_MS },
    );
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Finale match');
    expect(rows[0]).toHaveTextContent('70');
    expect(rows[0]).toHaveTextContent('Finale');
    expect(rows[1]).toHaveTextContent('Older match');
    expect(within(rows[0]!).getByRole('link', { name: 'Test Show' })).toHaveAttribute(
      'href',
      expect.stringContaining(routes.game.eventHistory()),
    );
    expect(
      within(rows[0]!).getByRole('button', { name: 'Why is Heat after this segment 80?' }),
    ).toBeInTheDocument();
    expect(
      within(rows[1]!).getByRole('button', { name: 'Why is Heat after this segment 70?' }),
    ).toBeInTheDocument();
  });

  it('suggests ending once the finale has been played', async () => {
    const world = heatWorld();
    renderPage(world, world.hot);
    await heading(HOT);
    expect(
      await screen.findByText(finalePlayedText(TEST_START_DATE), undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'End and pay off' })).toBeInTheDocument();
  });

  it('previews the payoff per member, ends it on confirm and then shows what was paid', async () => {
    const world = heatWorld();
    const { user, transport } = renderPage(world, world.hot);
    await heading(HOT);
    await user.click(screen.getByRole('button', { name: 'End storyline' }));
    const sheet = await screen.findByRole('dialog', { name: `End ${HOT}?` });
    const members = await within(sheet).findByRole(
      'list',
      { name: 'Members' },
      { timeout: LOAD_MS },
    );
    expect(within(members).getAllByRole('listitem')).toHaveLength(2);
    expect(within(sheet).getByText('Payoff strength')).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button', { name: /popularity for/ })).toHaveLength(2);
    expect(within(sheet).getAllByRole('button', { name: /momentum for/ })).toHaveLength(2);

    const { result: preview } = await transport.host.query('storylines.payoff', {
      storylineId: world.hot,
    });
    if (!preview.ok || preview.data.kind !== 'preview') throw new Error('expected a preview');

    await user.click(within(sheet).getByRole('button', { name: 'End storyline' }));
    await waitFor(
      () => {
        expect(screen.queryByRole('dialog', { name: `End ${HOT}?` })).toBeNull();
      },
      { timeout: LOAD_MS },
    );
    const ending = await screen.findByRole('region', { name: 'Ending' }, { timeout: LOAD_MS });
    expect(
      await within(ending).findByText('Payoff', undefined, { timeout: LOAD_MS }),
    ).toBeVisible();
    const { result: paid } = await transport.host.query('storylines.payoff', {
      storylineId: world.hot,
    });
    if (!paid.ok || paid.data.kind !== 'paid') throw new Error('expected a paid record');
    // What was applied is what the preview said.
    expect(paid.data.record.members.map((member) => member.popularityDelta)).toEqual(
      preview.data.plan.members.map((member) => member.popularity.value),
    );
    expect(within(ending).getAllByRole('listitem')).toHaveLength(2);
  });

  it('says a short storyline pays nothing, still ends it, and warns about booked segments', async () => {
    const world = heatWorld();
    const { user } = renderPage(world, world.short);
    await heading(SHORT);
    await user.click(screen.getByRole('button', { name: 'End storyline' }));
    const sheet = await screen.findByRole('dialog', { name: `End ${SHORT}?` });
    expect(
      await within(sheet).findByText(/No payoff \(needs 4 linked segments, has 1\)/, undefined, {
        timeout: LOAD_MS,
      }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(stillBookedText('Test Next Show'))).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'End storyline' }));
    expect(
      await screen.findByText('No payoff (needs 4 linked segments, had 1)', undefined, {
        timeout: LOAD_MS,
      }),
    ).toBeInTheDocument();
  });

  it('hides Set heat outside a Sandbox game', async () => {
    const normal = heatWorld(false);
    renderPage(normal, normal.short);
    await heading(SHORT);
    await screen.findByText(BOOKED_TEXT, undefined, { timeout: LOAD_MS });
    expect(screen.queryByRole('textbox', { name: 'New heat' })).toBeNull();
  });

  it('sets the heat by hand in a Sandbox game', async () => {
    const sandbox = heatWorld(true);
    const { user, transport } = renderPage(sandbox, sandbox.short);
    await heading(SHORT);
    const field = await screen.findByRole('textbox', { name: 'New heat' }, { timeout: LOAD_MS });
    await user.clear(field);
    await user.type(field, '75');
    await user.click(screen.getByRole('button', { name: 'Set heat' }));
    await waitFor(
      async () => {
        const { result } = await transport.host.query('storylines.detail', {
          storylineId: sandbox.short,
        });
        expect(result.ok && result.data.heat).toBe(75);
      },
      { timeout: LOAD_MS },
    );
  });
});

describe('the results page Storylines section (CRTV4-05)', () => {
  const fixture = aftermathShow();
  const view = {
    ...fixture,
    segments: fixture.segments.map((segment) => ({ ...segment, storylines: [] })),
  };
  const [, second, third] = view.segments;
  if (second === undefined || third === undefined) {
    throw new Error('The fixture show has segments');
  }
  const loser = second.sides[1]?.members[0];
  if (loser === undefined) throw new Error('The singles match has a loser');
  const storylineA = parseId('storyline', 'sty_0000000001');
  const storylineB = parseId('storyline', 'sty_0000000002');
  const linkedView = {
    ...view,
    segments: view.segments.map((segment, index) =>
      index === 1 || index === 2
        ? { ...segment, storylines: [{ id: storylineA, name: 'Test Rivalry' }] }
        : segment,
    ),
  };
  // Listed out of running order on purpose: the section puts them back in card order.
  const progress: StorylineShowProgress = {
    kind: 'ok',
    pastDetailWindow: false,
    segments: [
      {
        segmentId: third.segmentId,
        slot: third.slot,
        preShow: third.preShow,
        rows: [
          {
            storylineId: storylineA,
            name: 'Test Rivalry',
            heatBefore: 62,
            heatAfter: 62,
            traceRef: fakeRef('third'),
            finale: false,
          },
        ],
        notCounted: [],
        protectedLosers: [],
      },
      {
        segmentId: second.segmentId,
        slot: second.slot,
        preShow: second.preShow,
        rows: [
          {
            storylineId: storylineA,
            name: 'Test Rivalry',
            heatBefore: 54,
            heatAfter: 62,
            traceRef: fakeRef('second'),
            finale: true,
          },
        ],
        notCounted: [
          {
            storylineId: storylineB,
            name: 'Test Other Story',
            reason: 'Nobody in this segment is in the storyline',
          },
        ],
        protectedLosers: [{ personId: loser.personId, storylineId: storylineA }],
      },
    ],
  };

  function renderSection(answer: StorylineShowProgress) {
    const transport = createInProcessTransport(cannedFactory({ showProgress: answer }), {
      progressIntervalMs: 0,
    });
    transport.host.installEngine(heatWorld().state);
    return render(
      <EngineProvider createTransport={() => transport}>
        <MemoryRouter future={routerFutureFlags}>
          <StorylinesResultsSection
            eventInstanceId={linkedView.eventInstanceId}
            view={linkedView}
          />
        </MemoryRouter>
      </EngineProvider>,
    );
  }

  it('is registered, and left out for a show with no linked segment or a rival show', () => {
    const section = listResultsSections().find((entry) => entry.id === STORYLINES_SECTION_ID);
    if (section === undefined) throw new Error('The Storylines section is registered');
    expect(section.label).toBe(STORYLINES_SECTION_LABEL);
    expect(section.render({ eventInstanceId: view.eventInstanceId, view })).toBeNull();
    expect(
      section.render({
        eventInstanceId: view.eventInstanceId,
        view: { ...linkedView, mine: false },
      }),
    ).toBeNull();
    expect(
      section.render({ eventInstanceId: view.eventInstanceId, view: linkedView }),
    ).not.toBeNull();
  });

  it('lists each linked segment in card order with its heat chips, misses and losers', async () => {
    renderSection(progress);
    const headings = await screen.findAllByRole('heading', { level: 3 }, { timeout: LOAD_MS });
    expect(headings.map((node) => node.textContent)).toEqual([
      `Slot ${String(second.slotNumber)}: ${second.roleLabel}`,
      `Slot ${String(third.slotNumber)}: ${third.roleLabel}`,
    ]);
    expect(screen.getByText("Not counted: nobody in this segment is in 'Test Other Story'")).toBeVisible();
    expect(screen.getByText(lostInsideText('Test Rivalry'))).toBeVisible();
    expect(screen.getByRole('link', { name: loser.name })).toBeInTheDocument();
    expect(screen.getByText('+8')).toBeInTheDocument();
    expect(screen.getByText('(no change)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Why is Heat after this segment/ })).toHaveLength(
      2,
    );
  });

  it('draws nothing when the engine says the show is not yours', async () => {
    const { container } = renderSection({
      kind: 'unavailable',
      reason: { code: 'notYourShow', message: 'Not yours' },
    });
    await waitFor(
      () => {
        expect(container).toBeEmptyDOMElement();
      },
      { timeout: LOAD_MS },
    );
  });
});
