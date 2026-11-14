import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, QueryName, TraceNode } from '@ringside/engine';
import { TINY_WORLD_TODAY } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { devSeat } from '@/app/dev/EnterShellRoute';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { MISSING_TEXT } from '@/text/renderTemplatedText';
import { newsCountText } from './NewsScreen';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;
const SEASON_STORY = 'nws_0000000001';
const CAREER_STORY = 'nws_0000000002';
const SEASON_HEADLINE = 'Season 1 has begun';
const CAREER_HEADLINE = /marks \d+ years in the ring$/;
const BUZZ_TRACE: TraceNode = {
  kind: 'formula',
  label: 'Buzz',
  value: 47,
  children: [{ kind: 'input', label: 'A milestone story starts at', value: 47 }],
};

interface Asked {
  readonly name: QueryName;
  readonly args: unknown;
}

/**
 * The tiny world's two stories (DAY1-02), with the season story moved into this week so it leads
 * the front page, the career story's buzz breakdown in the trace store, and optionally a third
 * story whose topic has no words in the catalog.
 */
function newsState({ unknownTopic = false }: { readonly unknownTopic?: boolean } = {}) {
  const state: EngineState = fakeEngineState();
  const tables = state.world.tables as Record<string, Record<string, unknown>[]>;
  const news = tables['news'] ?? [];
  const yesterday = '2026-04-09';
  tables['news'] = news.map((row) =>
    row['id'] === SEASON_STORY ? { ...row, date: yesterday } : row,
  );
  if (unknownTopic) {
    const [first] = news;
    tables['news'].push({
      ...first,
      id: 'nws_0000000003',
      date: yesterday,
      kind: 'rumour',
      headline: { key: 'news.no-such-topic.headline', params: {} },
      body: { key: 'news.no-such-topic.body', params: {} },
      importance: 1,
      buzz: 10,
      dedupeKey: null,
      expiresOn: null,
    });
  }
  state.traces = {
    version: 1,
    seq: 1,
    full: [
      {
        ref: { kind: 'news.buzz', id: CAREER_STORY },
        date: TINY_WORLD_TODAY,
        seq: 1,
        trace: BUZZ_TRACE,
        value: 47,
      },
    ],
    summaries: [],
  };
  return state;
}

function renderNews(path: string = routes.game.news(), state: EngineState | null = newsState()) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  if (state === null) {
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: devSeat('pro_dev') });
  } else {
    const install = transport.host.installEngine(state);
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  }
  const asked: Asked[] = [];
  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    asked.push({ name, args });
    return runQuery(name, args);
  };
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  const feedArgs = (): unknown[] =>
    asked.filter((query) => query.name === 'news.feed').map((query) => query.args);
  return { router, user: userEvent.setup({ delay: null }), feedArgs };
}

async function findFeed(): Promise<HTMLElement> {
  const table = await screen.findByRole('grid', { name: 'All stories' }, { timeout: LOAD_MS });
  await waitFor(
    () => {
      expect(table.querySelectorAll('tbody tr[data-row-id]').length).toBeGreaterThan(0);
    },
    { timeout: LOAD_MS },
  );
  return table;
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

describe('newsCountText', () => {
  it('counts the stories, and says when only some are shown', () => {
    expect(newsCountText(1, 1)).toBe('1 story');
    expect(newsCountText(2, 2)).toBe('2 stories');
    expect(newsCountText(200, 340)).toBe('Showing 200 of 340 stories');
  });
});

describe('NewsScreen', () => {
  it('shows the front page and the feed, with News live in the sidebar', async () => {
    renderNews();

    expect(await screen.findByRole('heading', { level: 1, name: 'News' })).toBeInTheDocument();
    const front = await screen.findByRole('region', { name: 'Front page' }, { timeout: LOAD_MS });
    const hero = within(front).getByRole('article');
    expect(within(hero).getByRole('link', { name: SEASON_HEADLINE })).toHaveAttribute(
      'href',
      `${routes.game.news()}?story=${SEASON_STORY}`,
    );
    expect(hero).toHaveTextContent('It opened on Monday, January 5, 2026');

    const feed = await findFeed();
    expect(within(feed).getByRole('link', { name: SEASON_HEADLINE })).toBeInTheDocument();
    expect(within(feed).getByRole('link', { name: CAREER_HEADLINE })).toBeInTheDocument();
    expect(screen.getByText('2 stories')).toBeInTheDocument();
    expect(screen.queryByText("This screen isn't built yet")).toBeNull();
  });

  it('puts the filters in the query and the URL', async () => {
    const { router, user, feedArgs } = renderNews();
    await findFeed();

    await user.click(screen.getByRole('switch', { name: 'Front page only' }));
    await waitFor(() => {
      expect(router.state.location.search).toContain('front=1');
    });
    await waitFor(() => {
      expect(feedArgs().at(-1)).toMatchObject({ frontPageOnly: true });
    });
    const feed = await findFeed();
    await waitFor(() => {
      expect(within(feed).queryByRole('link', { name: CAREER_HEADLINE })).toBeNull();
    });

    await user.click(screen.getByRole('button', { name: 'Milestone' }));
    await waitFor(() => {
      expect(router.state.location.search).toContain('kind=milestone');
    });
    await waitFor(() => {
      expect(feedArgs().at(-1)).toMatchObject({ kinds: ['milestone'], frontPageOnly: true });
    });
    expect(screen.getByRole('button', { name: 'Milestone' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reads the filters and the period from the URL', async () => {
    const { feedArgs } = renderNews(`${routes.game.news()}?kind=season,nonsense&period=7&mine=1`);
    // The season story names no promotion, so nothing is left once "mine" is on.
    expect(
      await screen.findByRole(
        'heading',
        { name: 'No stories match these filters' },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(feedArgs()[0]).toEqual({
      from: '2026-04-04',
      kinds: ['season'],
      mine: true,
      limit: 200,
    });
    expect(screen.getByRole('switch', { name: 'My promotion only' })).toBeChecked();
  });

  it('opens the story from ?story= and closes it again', async () => {
    const { router, user } = renderNews(`${routes.game.news()}?story=${CAREER_STORY}`);

    const sheet = await screen.findByRole(
      'dialog',
      { name: CAREER_HEADLINE },
      { timeout: LOAD_MS },
    );
    expect(within(sheet).getByRole('heading', { name: "Who's in this story" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Major');
    expect(sheet).toHaveTextContent('Leaves the archive on Saturday, May 9, 2026');

    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(router.state.location.search).not.toContain('story=');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('says when the story is gone', async () => {
    renderNews(`${routes.game.news()}?story=nws_0000000099`);
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Story not found' },
      { timeout: LOAD_MS },
    );
    expect(sheet).toHaveTextContent('This story is no longer in the news archive');
  });

  it("opens the buzz's Why? from the story", async () => {
    const { user } = renderNews(`${routes.game.news()}?story=${CAREER_STORY}`);
    const sheet = await screen.findByRole(
      'dialog',
      { name: CAREER_HEADLINE },
      { timeout: LOAD_MS },
    );

    await user.click(within(sheet).getByRole('button', { name: 'Why is Buzz 47?' }));
    expect(await screen.findByRole('dialog', { name: 'Buzz' })).toBeInTheDocument();
  });

  it('shows "[missing text]" for a story whose words are not written yet', async () => {
    renderNews(routes.game.news(), newsState({ unknownTopic: true }));
    const feed = await findFeed();
    await waitFor(() => {
      expect(within(feed).getByText(MISSING_TEXT)).toBeInTheDocument();
    });
  });

  it('says no game is loaded without a world', async () => {
    renderNews(routes.game.news(), null);
    expect(
      await screen.findByRole('heading', { name: 'No game loaded' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'News ticker' })).toBeNull();
  });
});

describe('the shell ticker', () => {
  it('crawls the headlines from news.top as text', async () => {
    renderNews(routes.game.office());

    const ticker = await screen.findByRole('region', { name: 'News ticker' }, { timeout: LOAD_MS });
    expect(ticker).toHaveTextContent('Breaking');
    expect(ticker).toHaveTextContent(SEASON_HEADLINE);
    expect(ticker).toHaveTextContent(CAREER_HEADLINE);
    expect(within(ticker).queryAllByRole('link')).toHaveLength(0);
    expect(ticker).not.toHaveTextContent('Sample news');
  });
});
