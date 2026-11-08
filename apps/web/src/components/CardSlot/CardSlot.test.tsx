import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ImageSubject } from '@/components/ImageSlot';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { CardSlot, CardSlotDragHandle, defaultCardSlotAccent } from './CardSlot';
import type { CardSlotChip, CardSlotSide } from './CardSlot';

function person(id: string, name: string): ImageSubject {
  return { kind: 'person', id, name };
}

const SIDE_A: CardSlotSide = {
  name: 'Marlo Quint',
  label: 'Face',
  members: [person('per_000001', 'Marlo Quint')],
  detail: 'Momentum 88',
};

const SIDE_B: CardSlotSide = {
  name: 'Otto Krell & Bastian Volk',
  label: 'Challengers',
  members: [person('per_000002', 'Otto Krell'), person('per_000003', 'Bastian Volk')],
};

const CHIPS: readonly CardSlotChip[] = [
  { id: 'type', kind: 'match-type', label: 'Singles' },
  { id: 'title', kind: 'title', label: 'Coastal Crown' },
  { id: 'story', kind: 'storyline', label: 'Street grudge' },
];

describe('CardSlot', () => {
  it('is an article named by its slot number and role', () => {
    render(<CardSlot slotRole="opener" slotNumber={1} sideA={SIDE_A} sideB={SIDE_B} />);

    const slot = screen.getByRole('article', { name: 'Slot 1: Opener' });
    expect(within(slot).getByRole('heading', { level: 3 })).toHaveTextContent('Slot 1//Opener');
    expect(slot).toHaveAttribute('data-state', 'booked');
    expect(slot).toHaveAttribute('data-role', 'opener');
    expect(slot.querySelector('[style]')).toBeNull();
  });

  it('shows both sides with decorative avatars and vs between them', () => {
    render(<CardSlot slotRole="midcard" sideA={SIDE_A} sideB={SIDE_B} />);

    const slot = screen.getByRole('article', { name: 'Midcard' });
    expect(within(slot).getByText('Marlo Quint')).toBeInTheDocument();
    expect(within(slot).getByText('Otto Krell & Bastian Volk')).toBeInTheDocument();
    expect(within(slot).getByText('vs')).toBeInTheDocument();
    expect(within(slot).getByText('Momentum 88')).toBeInTheDocument();
    // The names are in the text, so the avatars are not announced a second time.
    expect(within(slot).queryAllByRole('img')).toHaveLength(0);
    expect(slot.querySelectorAll('[data-kind="person"]')).toHaveLength(3);
  });

  it('lists the chips by kind', () => {
    render(<CardSlot slotRole="semi-main" sideA={SIDE_A} sideB={SIDE_B} chips={CHIPS} />);

    const chips = screen.getByRole('list', { name: 'Segment details' });
    const items = within(chips).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-kind'))).toEqual([
      'match-type',
      'title',
      'storyline',
    ]);
    expect(items.map((item) => item.textContent)).toEqual([
      'Singles',
      'Coastal Crown',
      'Street grudge',
    ]);
  });

  it('marks the chosen winner in words, not colour alone', () => {
    render(<CardSlot slotRole="main-event" sideA={SIDE_A} sideB={SIDE_B} winner="b" />);

    const slot = screen.getByRole('article', { name: 'Main Event' });
    const winners = slot.querySelectorAll('[data-part="winner"]');
    expect(winners).toHaveLength(1);
    expect(winners[0]).toHaveTextContent('Winner');
    expect(slot.querySelector('[data-side="b"]')).toHaveAttribute('data-winner', 'true');
    expect(slot.querySelector('[data-side="a"]')).toHaveAttribute('data-winner', 'false');
  });

  it('takes its own winner label', () => {
    render(
      <CardSlot
        slotRole="main-event"
        sideA={SIDE_A}
        sideB={SIDE_B}
        winner="a"
        winnerLabel="Chosen winner"
      />,
    );
    expect(screen.getByText('Chosen winner')).toBeInTheDocument();
  });

  it('shows one side for a promo', () => {
    render(<CardSlot slotRole="midcard" sideA={SIDE_A} />);

    const slot = screen.getByRole('article', { name: 'Midcard' });
    expect(within(slot).queryByText('vs')).toBeNull();
    expect(slot.querySelector('[data-side="b"]')).toBeNull();
  });

  it('offers Add match and Add promo when empty', async () => {
    const onAddMatch = vi.fn();
    const onAddPromo = vi.fn();
    render(
      <CardSlot
        slotRole="midcard"
        slotNumber={3}
        onAddMatch={onAddMatch}
        onAddPromo={onAddPromo}
        emptyHint="Add a match or a promo to build momentum."
      />,
    );

    const slot = screen.getByRole('article', { name: 'Slot 3: Midcard' });
    expect(slot).toHaveAttribute('data-state', 'empty');
    expect(within(slot).getByText('Open slot')).toBeInTheDocument();
    await userEvent.click(within(slot).getByRole('button', { name: 'Add match' }));
    await userEvent.click(within(slot).getByRole('button', { name: 'Add promo' }));
    expect(onAddMatch).toHaveBeenCalledTimes(1);
    expect(onAddPromo).toHaveBeenCalledTimes(1);
  });

  it('shows only the add actions it was given', () => {
    render(<CardSlot slotRole="pre-show" onAddMatch={() => undefined} emptyTitle="No pre-show" />);

    const slot = screen.getByRole('article', { name: 'Pre-show' });
    expect(within(slot).getByText('No pre-show')).toBeInTheDocument();
    expect(within(slot).getAllByRole('button')).toHaveLength(1);
  });

  it('puts the drag handle and actions in their slots', () => {
    render(
      <CardSlot
        slotRole="opener"
        slotNumber={1}
        sideA={SIDE_A}
        sideB={SIDE_B}
        dragHandle={<CardSlotDragHandle label="Move slot 1" />}
        actions={<button type="button">More</button>}
      />,
    );

    const slot = screen.getByRole('article', { name: 'Slot 1: Opener' });
    const handle = within(slot).getByRole('button', { name: 'Move slot 1' });
    expect(handle).toHaveAttribute('type', 'button');
    expect(within(slot).getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('picks the accent from the role and chips unless told', () => {
    expect(defaultCardSlotAccent('main-event', CHIPS)).toBe('action');
    expect(defaultCardSlotAccent('midcard', CHIPS)).toBe('prestige');
    expect(defaultCardSlotAccent('opener')).toBe('data');

    render(<CardSlot slotRole="opener" sideA={SIDE_A} accent="prestige" />);
    expect(screen.getByRole('article', { name: 'Opener' })).toHaveClass('accent-prestige');
  });

  it('has no motion, so reduced motion renders it the same', () => {
    const withoutIds = (html: string) => html.replace(/:r[0-9a-z]+:/g, 'id');
    const { container: withMotion } = render(
      <CardSlot slotRole="opener" sideA={SIDE_A} sideB={SIDE_B} winner="a" />,
    );
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    const { container: reduced } = render(
      <CardSlot slotRole="opener" sideA={SIDE_A} sideB={SIDE_B} winner="a" />,
    );
    expect(withoutIds(reduced.innerHTML)).toBe(withoutIds(withMotion.innerHTML));
  });
});
