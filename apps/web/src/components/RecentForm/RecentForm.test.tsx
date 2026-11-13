import { render as renderPlain, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory } from '@/test/fakeEngine';
import {
  RecentForm,
  recentFormItemLabel,
  RECENT_FORM_STRIP_MAX,
  UNKNOWN_CHANGE,
} from './RecentForm';
import { mixedForm, unknownChangesForm, winStreakForm } from './recentFormFixtures';

/** A Why? by reference reads the engine when it opens, so the list needs a provider. */
function render(element: ReactElement) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  return renderPlain(<EngineProvider createTransport={() => transport}>{element}</EngineProvider>);
}

describe('RecentForm', () => {
  it('draws a strip of result pills, each named in full', () => {
    const items = mixedForm();
    render(<RecentForm items={items} variant="strip" />);

    const strip = screen.getByRole('list', { name: 'Recent results, newest first' });
    const pills = within(strip).getAllByRole('listitem');
    expect(pills.map((pill) => pill.textContent)).toEqual(['W', 'L', 'D', 'NC', 'L']);
    const first = items[0];
    if (first === undefined) throw new Error('The fixture lost its first match.');
    expect(pills[0]).toHaveAccessibleName(recentFormItemLabel(first));
    expect(recentFormItemLabel(first)).toBe(
      'Win against Kara Voss, Altura Mainstage, Jan 30, 2027',
    );
    expect(pills[4]).toHaveAccessibleName(
      'Loss against Kara Voss, Rex Harlan and Vic Moreno, Altura Uprising, Jan 2, 2027',
    );
    expect(within(strip).getAllByText('W')[0]).toHaveClass('tone-positive');
    expect(within(strip).getAllByText('L')[0]).toHaveClass('tone-negative');
    expect(within(strip).getByText('NC')).toHaveClass('tone-neutral');
  });

  it('shows at most ten pills', () => {
    render(
      <RecentForm
        items={[...winStreakForm(), ...mixedForm(), ...unknownChangesForm()]}
        variant="strip"
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(RECENT_FORM_STRIP_MAX);
  });

  it('lists each match with its changes, a Why? while kept and a dash when unknown', () => {
    render(<RecentForm items={unknownChangesForm()} variant="list" />);

    const table = screen.getByRole('grid', { name: 'Recent matches, newest first' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    const cell = (row: HTMLElement | undefined, column: string) =>
      row?.querySelector(`[data-column-id="${column}"]`)?.textContent;
    expect(cell(rows[0], 'popularity')).toBe('▲+1.2');
    expect(cell(rows[1], 'popularity')).toBe(UNKNOWN_CHANGE);
    expect(cell(rows[1], 'momentum')).toBe(UNKNOWN_CHANGE);
    expect(cell(rows[2], 'momentum')).toBe(UNKNOWN_CHANGE);
    // These breakdowns are no longer kept, so no Why? opens nothing.
    expect(within(table).queryAllByRole('button', { name: /^Why is/ })).toHaveLength(0);
  });

  it('offers a Why? for every change whose breakdown is kept', () => {
    render(<RecentForm items={winStreakForm()} variant="list" />);
    expect(screen.getAllByRole('button', { name: /^Why is Popularity change/ })).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: /^Why is Momentum change/ })).toHaveLength(5);
  });

  it('says so when there are no matches, in either variant', () => {
    const { unmount } = render(<RecentForm items={[]} variant="strip" />);
    expect(screen.getByText('No matches yet')).toBeInTheDocument();
    unmount();
    render(<RecentForm items={[]} variant="list" />);
    expect(screen.getByText('No matches yet')).toBeInTheDocument();
  });
});
