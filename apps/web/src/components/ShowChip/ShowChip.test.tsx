import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGameDate } from '@ringside/engine';
import { galleryRivalShow, galleryShow } from '@/screens/dev-gallery/fixtures/calendar';
import { IMPORTANCE_LABELS, IMPORTANCE_ORDER } from './importance';
import { ShowChip } from './ShowChip';
import { registerShowChipBadge } from './showChipBadges';

const cleanups: (() => void)[] = [];

afterEach(() => {
  act(() => {
    for (const unregister of cleanups.splice(0)) unregister();
  });
});

function ignoreOpen(): void {
  // Most tests only look at the chip.
}

describe('ShowChip', () => {
  it('is a button named by the show, its importance and its brand', () => {
    render(<ShowChip show={galleryShow()} onOpen={ignoreOpen} density="grid" />);
    const chip = screen.getByRole('button', { name: /Altura Overclock/ });
    expect(chip).toHaveAccessibleName('Altura Overclock , Regular Overclock');
    expect(chip).toHaveAttribute('type', 'button');
  });

  it('hands the show to onOpen when picked', async () => {
    const onOpen = vi.fn();
    const show = galleryShow();
    render(<ShowChip show={show} onOpen={onOpen} density="row" />);
    await userEvent.setup().click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(show);
  });

  it('keeps the full name as the tooltip and the accessible name, however long it is', () => {
    const name = 'Altura Overclock: The Grand Anniversary Celebration Spectacular';
    render(<ShowChip show={galleryShow({ name })} onOpen={ignoreOpen} density="grid" />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('title', name);
    expect(chip).toHaveAccessibleName(expect.stringContaining(name));
  });

  it.each(IMPORTANCE_ORDER)('marks a %s show and says so in words', (importance) => {
    render(<ShowChip show={galleryShow({ importance })} onOpen={ignoreOpen} density="grid" />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('data-importance', importance);
    expect(chip).toHaveAccessibleName(expect.stringContaining(IMPORTANCE_LABELS[importance]));
  });

  it('tags a show with its brand by default and leaves a promotion-wide show untagged', () => {
    const { rerender } = render(
      <ShowChip show={galleryShow()} onOpen={ignoreOpen} density="grid" />,
    );
    expect(screen.getByText('Overclock')).toBeInTheDocument();
    expect(screen.queryByText('ALT')).not.toBeInTheDocument();

    rerender(<ShowChip show={galleryShow({ brand: null })} onOpen={ignoreOpen} density="grid" />);
    expect(screen.queryByText('Overclock')).not.toBeInTheDocument();
  });

  it('leaves out a brand tag that would only repeat the show’s name', () => {
    const show = galleryShow();
    const brand = show.brand;
    if (brand === null) throw new Error('The gallery show has a brand.');
    render(
      <ShowChip
        show={{ ...show, name: 'Altura Mainstage', brand: { ...brand, name: 'Altura Mainstage' } }}
        onOpen={ignoreOpen}
        density="grid"
      />,
    );
    expect(screen.getAllByText('Altura Mainstage')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveAccessibleName('Altura Mainstage , Regular');
  });

  it('tags a show with the promotion’s short name when asked', () => {
    render(
      <ShowChip show={galleryRivalShow(0)} onOpen={ignoreOpen} density="grid" tag="promotion" />,
    );
    expect(screen.getByText('HCP')).toBeInTheDocument();
  });

  it('tells the viewer’s own shows from a rival’s', () => {
    render(
      <>
        <ShowChip show={galleryShow({ name: 'Mine' })} onOpen={ignoreOpen} density="grid" />
        <ShowChip
          show={galleryRivalShow(0, { name: 'Theirs' })}
          onOpen={ignoreOpen}
          density="grid"
        />
      </>,
    );
    expect(screen.getByRole('button', { name: /Mine/ })).toHaveAttribute('data-own', 'true');
    expect(screen.getByRole('button', { name: /Theirs/ })).toHaveAttribute('data-own', 'false');
  });

  it('says in words that a show was cancelled', () => {
    const show = galleryShow({
      status: 'cancelled',
      cancellation: { reason: 'byPromotion', on: parseGameDate('2027-01-05') },
    });
    render(<ShowChip show={show} onOpen={ignoreOpen} density="grid" />);
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('data-status', 'cancelled');
    expect(within(chip).getByText('Cancelled')).toBeVisible();
  });

  it('says in words that a show did not run', () => {
    const show = galleryShow({
      status: 'cancelled',
      cancellation: { reason: 'notRun', on: parseGameDate('2027-01-05') },
    });
    render(<ShowChip show={show} onOpen={ignoreOpen} density="row" />);
    expect(within(screen.getByRole('button')).getByText('Not run')).toBeVisible();
  });

  it('marks a projected show and tells screen readers', () => {
    render(
      <ShowChip show={galleryShow({ status: 'projected' })} onOpen={ignoreOpen} density="grid" />,
    );
    const chip = screen.getByRole('button');
    expect(chip).toHaveAttribute('data-status', 'projected');
    expect(chip).toHaveAccessibleName(expect.stringContaining('Projected'));
  });

  it('draws the badges other features register, in order, and drops them again', () => {
    render(<ShowChip show={galleryShow()} onOpen={ignoreOpen} density="row" />);
    expect(screen.queryByText('Taped')).not.toBeInTheDocument();

    let removeTaped: () => void = () => undefined;
    act(() => {
      cleanups.push(
        registerShowChipBadge({ id: 'test.hype', order: 20, render: () => 'Hot' }),
        registerShowChipBadge({ id: 'test.hidden', order: 15, render: () => null }),
      );
      removeTaped = registerShowChipBadge({ id: 'test.taped', order: 10, render: () => 'Taped' });
    });
    const chip = screen.getByRole('button');
    expect(chip).toHaveAccessibleName('Altura Overclock , Regular Overclock Taped Hot');

    act(() => {
      removeTaped();
    });
    expect(screen.queryByText('Taped')).not.toBeInTheDocument();
    expect(screen.getByText('Hot')).toBeInTheDocument();
  });

  it('hands each badge the show it is drawn on', () => {
    act(() => {
      cleanups.push(
        registerShowChipBadge({
          id: 'test.slots',
          order: 10,
          render: ({ show }) => `${String(show.format.slots)} slots`,
        }),
      );
    });
    render(<ShowChip show={galleryShow()} onOpen={ignoreOpen} density="grid" />);
    expect(screen.getByText('6 slots')).toBeInTheDocument();
  });
});
