import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import type { EngineState } from '@ringside/engine';
import { fakeEngineState } from '@/test/fakeEngine';
import { renderOfficePanel } from '@/test/officePanel';
import { templatedTextToString } from '@/text/renderTemplatedText';
import {
  NO_NEWS_TITLE,
  OPEN_NEWS_TEXT,
  TOP_STORIES_PANEL_ID,
  TOP_STORIES_TITLE,
  TopStoriesPanel,
  storyUrl,
  topStoriesOf,
} from './officePanel';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;
const SEASON_STORY = 'nws_0000000001';

/** The tiny world's stories (DAY1-02), with the season story moved into this week's front page. */
function newsState(): EngineState {
  const state = fakeEngineState();
  const tables = state.world.tables as Record<string, Record<string, unknown>[]>;
  tables['news'] = (tables['news'] ?? []).map((row) =>
    row['id'] === SEASON_STORY ? { ...row, date: '2026-04-09' } : row,
  );
  return state;
}

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the Office "Top stories" panel (DAY1-06, with DAY2)', () => {
  it("lists the front page's hero stories, each linking to its story, and opens News", async () => {
    const { transport } = await renderOfficePanel(TOP_STORIES_PANEL_ID, { state: newsState() });
    const answer = await transport.host.query('news.top', {});
    if (!answer.result.ok) throw new Error('news.top was refused');
    const top = answer.result.data;
    const stories = topStoriesOf(top);
    expect(stories.length).toBeGreaterThan(0);

    const panel = await screen.findByRole(
      'region',
      { name: TOP_STORIES_TITLE },
      { timeout: LOAD_MS },
    );
    const items = within(within(panel).getByRole('list', { name: TOP_STORIES_TITLE })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(stories.length);
    stories.forEach((story, index) => {
      const item = items[index];
      if (item === undefined) throw new Error(`no row for ${story.id}`);
      const headline = templatedTextToString(story.headline, { names: top.names });
      expect(within(item).getByRole('link', { name: headline })).toHaveAttribute(
        'href',
        storyUrl(story.id),
      );
      expect(within(item).getByText(story.kindLabel)).toBeInTheDocument();
      expect(within(item).getByText('Buzz')).toBeInTheDocument();
    });
    expect(within(panel).getByRole('link', { name: OPEN_NEWS_TEXT })).toHaveAttribute(
      'href',
      routes.game.news(),
    );
  });

  it('says there is no news yet, with no sample stories', () => {
    const router = createMemoryRouter(
      [{ path: '*', element: <TopStoriesPanel stories={[]} names={{}} /> }],
      { initialEntries: ['/game/office'], future: routerFutureFlags },
    );
    render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
    const panel = screen.getByRole('region', { name: TOP_STORIES_TITLE });
    expect(within(panel).getByText(NO_NEWS_TITLE)).toBeInTheDocument();
    expect(within(panel).queryByRole('list')).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: OPEN_NEWS_TEXT })).toBeInTheDocument();
  });

  it('keeps at most three stories', () => {
    const hero = [1, 2, 3, 4].map((serial) => ({ id: `news_${String(serial)}` }));
    expect(topStoriesOf({ hero }).map((item) => item.id)).toEqual(['news_1', 'news_2', 'news_3']);
  });
});
