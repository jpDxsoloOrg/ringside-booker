import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registerBookingPanel, registeredBookingPanels, useBookingPanels } from './bookingPanels';
import type { BookingPanelDefinition } from './bookingPanels';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function panel(id: string, order: number): BookingPanelDefinition {
  return { id, order, placement: 'side', render: () => id };
}

function PanelIds() {
  const panels = useBookingPanels();
  return <p>{panels.map((entry) => entry.id).join(',')}</p>;
}

describe('registerBookingPanel', () => {
  it('adds a panel and returns a function that removes it', () => {
    const remove = registerBookingPanel(panel('test.forecast', 10));
    expect(registeredBookingPanels().map((entry) => entry.id)).toEqual(['test.forecast']);
    remove();
    expect(registeredBookingPanels()).toEqual([]);
  });

  it('throws for an id that is taken', () => {
    cleanups.push(registerBookingPanel(panel('test.venue', 10)));
    expect(() => registerBookingPanel(panel('test.venue', 20))).toThrow(
      'A booking panel with id "test.venue" is already registered.',
    );
  });

  it('keeps every open screen current, lowest order first', () => {
    cleanups.push(registerBookingPanel(panel('test.second', 20)));
    render(<PanelIds />);
    expect(screen.getByText('test.second')).toBeInTheDocument();

    let removeFirst: () => void = () => undefined;
    act(() => {
      removeFirst = registerBookingPanel(panel('test.first', 10));
    });
    expect(screen.getByText('test.first,test.second')).toBeInTheDocument();

    act(() => {
      removeFirst();
    });
    expect(screen.getByText('test.second')).toBeInTheDocument();
  });
});
