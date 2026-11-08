import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { Ticker, tickerLengthClass } from './Ticker';
import type { TickerItem } from './Ticker';

const HEADLINES: readonly TickerItem[] = [
  { id: 'one', content: 'Harbor Arena sells out for Thursday', tag: 'Gate', tagTone: 'prestige' },
  { id: 'two', content: 'Rival show draws its best number of the year' },
  { id: 'three', content: 'Tag champions to defend on the road', tag: 'Title', tagTone: 'action' },
];

function renderTicker(props: Partial<Parameters<typeof Ticker>[0]> = {}) {
  render(<Ticker label="Breaking" items={HEADLINES} {...props} />);
  return screen.getByRole('region', { name: 'News ticker' });
}

describe('Ticker', () => {
  it('is a named region with a label badge and one readable list of headlines', () => {
    const ticker = renderTicker();

    expect(ticker).toHaveAttribute('data-motion', 'crawl');
    expect(within(ticker).getByText('Breaking')).toBeInTheDocument();
    // The loop copy is hidden from screen readers, so each headline is listed once.
    const list = within(ticker).getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(ticker.querySelector('[style]')).toBeNull();
  });

  it('draws a hidden, inert loop copy for the crawl', () => {
    const ticker = renderTicker();

    const loopCopy = ticker.querySelector('[data-part="loop-copy"]');
    expect(loopCopy).toHaveAttribute('aria-hidden', 'true');
    expect(loopCopy).toHaveAttribute('inert');
    expect(loopCopy?.querySelectorAll('li')).toHaveLength(3);
  });

  it('stays quiet for screen readers unless asked to announce', () => {
    const quiet = renderTicker();
    expect(within(quiet).getByRole('list')).toHaveAttribute('aria-live', 'off');
  });

  it('announces politely when asked', () => {
    render(
      <Ticker label="Live" items={HEADLINES} ariaLabel="Show night ticker" announce="polite" />,
    );
    const ticker = screen.getByRole('region', { name: 'Show night ticker' });
    expect(within(ticker).getByRole('list')).toHaveAttribute('aria-live', 'polite');
  });

  it('pauses and resumes from its toggle button', async () => {
    const ticker = renderTicker();
    const pause = within(ticker).getByRole('button', { name: 'Pause ticker' });

    expect(pause).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'true');
    expect(ticker).toHaveClass('paused');
    await userEvent.click(pause);
    expect(pause).toHaveAttribute('aria-pressed', 'false');
    expect(ticker).not.toHaveClass('paused');
  });

  it('becomes a static list with no loop copy or pause button under reduced motion', () => {
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const ticker = renderTicker();

    expect(ticker).toHaveAttribute('data-motion', 'static');
    expect(ticker).toHaveClass('static');
    expect(ticker.querySelector('[data-part="loop-copy"]')).toBeNull();
    expect(within(ticker).queryByRole('button')).toBeNull();
    expect(within(ticker).getAllByRole('listitem')).toHaveLength(3);
  });

  it('switches between crawl and static as the motion setting changes', () => {
    const ticker = renderTicker();

    act(() => {
      setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    });
    expect(ticker).toHaveAttribute('data-motion', 'static');

    act(() => {
      setMatchMedia(() => false);
    });
    expect(ticker).toHaveAttribute('data-motion', 'crawl');
    expect(ticker.querySelector('[data-part="loop-copy"]')).toHaveAttribute('inert');
  });

  it('does not crawl an empty list', () => {
    const ticker = renderTicker({ items: [] });
    expect(ticker).toHaveAttribute('data-motion', 'static');
  });

  it('can dock to the bottom edge', () => {
    expect(renderTicker({ docked: true })).toHaveClass('docked');
  });
});

describe('tickerLengthClass', () => {
  it('buckets the item count into the crawl length classes', () => {
    expect(tickerLengthClass(0)).toBe('items-1');
    expect(tickerLengthClass(3)).toBe('items-3');
    expect(tickerLengthClass(40)).toBe('items-12');
  });
});
