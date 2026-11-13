import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { TraceNode } from '@ringside/engine';
import { TraceTree } from '@/components/Trace';
import { AppShell } from './AppShell/AppShell';
import {
  EntityLinkContext,
  gameEntityLink,
  promotionLinkState,
  useEntityLinkRenderer,
  workerLinkState,
} from './entityLinks';
import { routerFutureFlags, routerProviderFutureFlags } from './router';
import { routes } from './routes';

const PERSON_ID = 'per_0000000001';
const PROMOTION_ID = 'pro_0000000001';

/** A breakdown whose inputs point at a person and at a promotion. */
const TRACE: TraceNode = {
  kind: 'formula',
  label: 'Match rating',
  value: 70,
  children: [
    {
      kind: 'input',
      label: 'Test Worker 001',
      value: 72,
      ref: { kind: 'person', id: PERSON_ID },
    },
    {
      kind: 'input',
      label: 'Test Promotion A',
      value: 40,
      ref: { kind: 'promotion', id: PROMOTION_ID },
    },
  ],
};

const memoryRouterFlags = { ...routerFutureFlags, ...routerProviderFutureFlags };

describe('entity names inside a Why? breakdown', () => {
  it('are plain text with no provider, as in the gallery and outside a game', () => {
    render(
      <MemoryRouter future={memoryRouterFlags}>
        <TraceTree root={TRACE} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Test Worker 001/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('link a person and a promotion to their profiles under the game provider', () => {
    render(
      <MemoryRouter future={memoryRouterFlags}>
        <EntityLinkContext.Provider value={gameEntityLink}>
          <TraceTree root={TRACE} />
        </EntityLinkContext.Provider>
      </MemoryRouter>,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('Test Worker 001');
    expect(links[0]).toHaveAttribute('href', `${routes.game.workers()}/${PERSON_ID}`);
    expect(links[1]).toHaveTextContent('Test Promotion A');
    expect(links[1]).toHaveAttribute('href', `${routes.game.promotions()}/${PROMOTION_ID}`);
  });

  it('use a renderer passed as a prop over the provider', () => {
    render(
      <MemoryRouter future={memoryRouterFlags}>
        <EntityLinkContext.Provider value={gameEntityLink}>
          <TraceTree root={TRACE} renderEntityLink={(_ref, label) => `[${label}]`} />
        </EntityLinkContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/\[Test Worker 001\]/)).toBeInTheDocument();
  });
});

describe('gameEntityLink', () => {
  it('keeps a person ref that is not a person id as plain text', () => {
    expect(gameEntityLink({ kind: 'person', id: 'nobody' }, 'Nobody')).toBe('Nobody');
  });

  it('keeps a promotion ref that is not a promotion id, and other kinds, as plain text', () => {
    expect(gameEntityLink({ kind: 'promotion', id: 'nowhere' }, 'Nowhere')).toBe('Nowhere');
    expect(gameEntityLink({ kind: 'title', id: 'tit_0000000001' }, 'A title')).toBe('A title');
  });
});

describe('AppShell', () => {
  function RendererProbe() {
    const renderer = useEntityLinkRenderer();
    return <p data-testid="probe">{renderer === gameEntityLink ? 'game' : 'plain'}</p>;
  }

  it('provides the game renderer to every screen inside it', () => {
    render(
      <MemoryRouter future={memoryRouterFlags} initialEntries={[routes.game.office()]}>
        <AppShell ticker={null}>
          <RendererProbe />
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('game');
  });

  it('is the only place that does: outside it the names stay plain', () => {
    render(<RendererProbe />);

    expect(screen.getByTestId('probe')).toHaveTextContent('plain');
  });
});

describe('workerLinkState', () => {
  const location = (pathname: string, search: string, state: unknown) => ({
    pathname,
    search,
    state,
    hash: '',
    key: 'test',
  });

  it('is the list URL with its filters on the workers list', () => {
    expect(workerLinkState(location(routes.game.workers(), '?role=referee', null))).toEqual({
      workersListUrl: `${routes.game.workers()}?role=referee`,
    });
  });

  it('carries the list URL on from one profile to the next', () => {
    const carried = { workersListUrl: `${routes.game.workers()}?q=test` };

    expect(workerLinkState(location(`${routes.game.workers()}/${PERSON_ID}`, '', carried))).toEqual(
      carried,
    );
  });

  it('is nothing anywhere else', () => {
    expect(workerLinkState(location(routes.game.roster(), '', null))).toBeUndefined();
  });
});

describe('promotionLinkState', () => {
  const location = (pathname: string, search: string, state: unknown) => ({
    pathname,
    search,
    state,
    hash: '',
    key: 'test',
  });

  it('is the list URL with its sort on the Promotions list', () => {
    expect(promotionLinkState(location(routes.game.promotions(), '?sort=prestige', null))).toEqual({
      promotionsListUrl: `${routes.game.promotions()}?sort=prestige`,
    });
  });

  it('carries the list URL on from a profile, and trusts only a Promotions URL', () => {
    const carried = { promotionsListUrl: `${routes.game.promotions()}?sort=name` };
    const profile = `${routes.game.promotions()}/${PROMOTION_ID}`;
    expect(promotionLinkState(location(profile, '', carried))).toEqual(carried);
    expect(
      promotionLinkState(location(profile, '', { promotionsListUrl: 'https://example.com' })),
    ).toBeUndefined();
  });
});
