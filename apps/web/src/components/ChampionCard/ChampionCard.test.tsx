import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import { ChampionCard, ChampionCardList, formatReignDays, prestigeStars } from './ChampionCard';
import type { ChampionCardReign, ChampionCardTitle } from './ChampionCard';

const CROWN: ChampionCardTitle = { id: 'tit_000001', name: 'Harbour Heavyweight Title' };
const REIGN: ChampionCardReign = {
  champion: { kind: 'person', id: 'per_000001', name: 'Marlo Quint' },
  days: 142,
  defences: 6,
};

describe('prestigeStars', () => {
  it.each([
    [0, 0],
    [9, 0],
    [10, 1],
    [50, 3],
    [82, 4],
    [100, 5],
    [140, 5],
    [-5, 0],
    [Number.NaN, 0],
  ])('gives prestige %s %s stars', (prestige, stars) => {
    expect(prestigeStars(prestige)).toBe(stars);
  });
});

describe('formatReignDays', () => {
  it('counts days in words', () => {
    expect(formatReignDays(1)).toBe('1 day');
    expect(formatReignDays(142)).toBe('142 days');
    expect(formatReignDays(1204)).toBe('1,204 days');
  });
});

describe('ChampionCard', () => {
  it('is an article named by the title, with the champion, reign and defences', () => {
    render(<ChampionCard title={CROWN} reign={REIGN} prestige={82} />);
    const card = screen.getByRole('article', { name: 'Harbour Heavyweight Title' });
    expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent(CROWN.name);
    expect(within(card).getByText('Marlo Quint')).toHaveClass('holderName');
    const terms = within(card)
      .getAllByRole('term')
      .map((term) => term.textContent);
    const values = within(card)
      .getAllByRole('definition')
      .map((definition) => definition.textContent);
    expect(terms).toEqual(['Reign', 'Defences']);
    expect(values).toEqual(['142 days', '6']);
  });

  it('draws the belt in gold unless the title has its own tier', () => {
    const { container, rerender } = render(
      <ChampionCard title={CROWN} reign={REIGN} prestige={82} />,
    );
    const metals = () =>
      new Set(
        Array.from(container.querySelectorAll('[data-kind="title"] [class^="metal"]'), (node) =>
          node.getAttribute('class'),
        ),
      );
    expect([...metals()]).toEqual(['metalGold']);

    rerender(<ChampionCard title={{ ...CROWN, tier: 'silver' }} reign={REIGN} prestige={82} />);
    expect([...metals()]).toEqual(['metalSilver']);
  });

  it('shows the champion picture next to their name', () => {
    const { container } = render(<ChampionCard title={CROWN} reign={REIGN} prestige={82} />);
    const avatar = container.querySelector('[data-kind="person"] svg');
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
    expect(avatar).toHaveAttribute('data-placeholder', 'person-initials');
  });

  it('shows prestige as a number and as stars', () => {
    const { container } = render(<ChampionCard title={CROWN} reign={REIGN} prestige={82} />);
    expect(screen.getByText('Prestige 82')).toBeInTheDocument();
    const stars = container.querySelector('[data-stars]');
    expect(stars).toHaveAttribute('data-stars', '4');
    expect(stars).toHaveAttribute('aria-hidden', 'true');
    expect(stars?.querySelectorAll('.starFilled')).toHaveLength(4);
    expect(stars?.querySelectorAll('.starEmpty')).toHaveLength(1);
  });

  it('keeps the prestige text to 0-100 and never prints NaN', () => {
    const { rerender } = render(<ChampionCard title={CROWN} reign={REIGN} prestige={140} />);
    expect(screen.getByText('Prestige 100')).toBeInTheDocument();
    rerender(<ChampionCard title={CROWN} reign={REIGN} prestige={Number.NaN} />);
    expect(screen.getByText('Prestige 0')).toBeInTheDocument();
  });

  it('says a title is vacant instead of showing a reign', () => {
    render(<ChampionCard title={CROWN} reign={null} prestige={40} />);
    const card = screen.getByRole('article', { name: CROWN.name });
    expect(card).toHaveAttribute('data-vacant', 'true');
    expect(within(card).getByText('Vacant')).toBeInTheDocument();
    expect(within(card).queryByRole('term')).toBeNull();
  });

  it('takes a heading level, a footer and a Why? slot', () => {
    render(
      <ChampionCard
        title={CROWN}
        reign={REIGN}
        prestige={82}
        headingLevel={4}
        footer="Next defence: Summit Night"
        why={<button type="button">Why? Prestige</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent(CROWN.name);
    expect(screen.getByText('Next defence: Summit Night')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Why? Prestige' })).toBeInTheDocument();
  });

  it('puts actions after the Why? chip, and none unless given', () => {
    const { rerender } = render(
      <ChampionCard
        title={CROWN}
        reign={REIGN}
        prestige={82}
        why={<button type="button">Why? Prestige</button>}
        actions={<button type="button">Actions</button>}
      />,
    );
    const [why, actions] = screen.getAllByRole('button');
    expect(why).toHaveAccessibleName('Why? Prestige');
    expect(actions).toHaveAccessibleName('Actions');
    rerender(<ChampionCard title={CROWN} reign={REIGN} prestige={82} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets the screen draw the title and champion names, as links say', () => {
    render(
      <ChampionCard
        title={CROWN}
        reign={REIGN}
        prestige={82}
        renderTitleName={(name) => <a href="/title">{name}</a>}
        renderChampionName={(name) => <a href="/champion">{name}</a>}
      />,
    );
    expect(screen.getByRole('heading', { level: 3 })).toContainElement(
      screen.getByRole('link', { name: CROWN.name }),
    );
    expect(screen.getByRole('link', { name: 'Marlo Quint' })).toHaveAttribute('href', '/champion');
  });

  it('writes no inline styles', () => {
    const { container } = render(<ChampionCard title={CROWN} reign={REIGN} prestige={82} />);
    expect(container.querySelector('[style]')).toBeNull();
  });
});

describe('ChampionCardList', () => {
  function renderList() {
    return render(
      <ChampionCardList label="Champions">
        <ChampionCard key="crown" title={CROWN} reign={REIGN} prestige={82} />
        <ChampionCard
          key="tag"
          title={{ id: 'tit_000002', name: 'Coastal Tag Titles' }}
          reign={null}
          prestige={55}
        />
      </ChampionCardList>,
    );
  }

  it('is a named region holding a list of cards', () => {
    renderList();
    const region = screen.getByRole('region', { name: 'Champions' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
    expect(within(region).getAllByRole('article')).toHaveLength(2);
  });

  it('is a grid on desktop with no extra tab stop', () => {
    renderList();
    const region = screen.getByRole('region', { name: 'Champions' });
    expect(region).toHaveAttribute('data-layout', 'grid');
    expect(region).not.toHaveAttribute('tabindex');
  });

  it('becomes a focusable swipe row on a phone, so the keyboard can scroll it', () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    renderList();
    const region = screen.getByRole('region', { name: 'Champions' });
    expect(region).toHaveAttribute('data-layout', 'swipe');
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('stacks one card per row on a phone when asked, with no extra tab stop', () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    render(
      <ChampionCardList label="Champions" phoneLayout="stack">
        <ChampionCard key="crown" title={CROWN} reign={REIGN} prestige={82} />
      </ChampionCardList>,
    );
    const region = screen.getByRole('region', { name: 'Champions' });
    expect(region).toHaveAttribute('data-layout', 'stack');
    expect(region).not.toHaveAttribute('tabindex');
    expect(region).toHaveClass('stack');
  });
});
