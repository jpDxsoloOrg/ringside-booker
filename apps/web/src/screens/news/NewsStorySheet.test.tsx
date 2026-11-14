import { isValidElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { parseContentKey, parseGameDate, parseId } from '@ringside/engine';
import type { EventInstanceId, NewsItemView, NewsNames } from '@ringside/engine';
import { EntityLinkContext, gameEntityLink } from '@/app/entityLinks';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import '@/text/catalogs/news.en';
import { plainEntityLabel } from '@/components/Trace/rows/rowTypes';
import { WorkerLink } from '@/components/WorkerLink';
import { newsEntityLink } from './newsEntityLink';
import { NewsStorySheet, SEE_RESULTS_TEXT } from './NewsStorySheet';

const SHOW = parseId('eventInstance', 'evi_0000000001');
const WINNER = parseId('person', 'per_0000000001');
const LOSER = parseId('person', 'per_0000000002');
const TITLE = 'ttl_0000000001';

const NAMES: NewsNames = {
  [SHOW]: { kind: 'eventInstance', name: 'Test Weekly' },
  [WINNER]: { kind: 'person', name: 'Big Joe' },
  [LOSER]: { kind: 'person', name: 'Fast Eddie' },
  [TITLE]: { kind: 'title', name: 'Test World Title' },
};

/** A title change at a show (EVT3 on the news wire), or the same story with no show. */
function titleChange(eventInstanceId: EventInstanceId | null): NewsItemView {
  const params = {
    titleId: TITLE,
    newHolderIds: WINNER,
    previousHolderIds: LOSER,
    eventInstanceId: eventInstanceId ?? SHOW,
  };
  return {
    id: parseId('news', 'nws_0000000009'),
    date: parseGameDate('2026-04-09'),
    kind: 'titleChange',
    kindLabel: 'Title change',
    headline: { key: parseContentKey('news.title-change.headline'), params },
    body: { key: parseContentKey('news.title-change.body'), params },
    refs: {
      personIds: [WINNER, LOSER],
      promotionIds: [],
      eventInstanceId,
      employmentId: null,
    },
    importance: 2,
    buzz: 50,
    buzzTraceRef: null,
    frontPage: false,
    expiresOn: null,
  };
}

function renderSheet(item: NewsItemView) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <EntityLinkContext.Provider value={gameEntityLink}>
            <NewsStorySheet
              open
              onClose={() => undefined}
              story={{ status: 'found', item, names: NAMES }}
            />
          </EntityLinkContext.Provider>
        ),
      },
    ],
    { initialEntries: ['/game/news'], future: routerFutureFlags },
  );
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return screen.getByRole('dialog', { name: 'Big Joe wins the Test World Title' });
}

describe('newsEntityLink (WRK1)', () => {
  it('draws people as WorkerLinks and leaves plain text plain', () => {
    const person = newsEntityLink(gameEntityLink)({ kind: 'person', id: WINNER }, 'Big Joe');
    expect(isValidElement(person) && person.type).toBe(WorkerLink);
    expect(newsEntityLink(plainEntityLabel)).toBe(plainEntityLabel);
  });
});

describe('the story sheet with partner stories (DAY1-06)', () => {
  it("links a show's story to its results", () => {
    const sheet = renderSheet(titleChange(SHOW));
    expect(within(sheet).getByRole('link', { name: SEE_RESULTS_TEXT })).toHaveAttribute(
      'href',
      routes.game.showResults(SHOW),
    );
  });

  it('has no results link for a story about no show', () => {
    const sheet = renderSheet(titleChange(null));
    expect(within(sheet).queryByRole('link', { name: SEE_RESULTS_TEXT })).toBeNull();
  });

  it("names people with WRK1's worker links, to their profiles", () => {
    const sheet = renderSheet(titleChange(SHOW));
    const who = within(sheet).getByRole('region', { name: "Who's in this story" });
    const link = within(who).getByRole('link', { name: 'Big Joe' });
    expect(link).toHaveAttribute('href', routes.game.worker(WINNER));
    // The body names them the same way.
    expect(within(sheet).getAllByRole('link', { name: 'Fast Eddie' })[0]).toHaveAttribute(
      'href',
      routes.game.worker(LOSER),
    );
  });
});
