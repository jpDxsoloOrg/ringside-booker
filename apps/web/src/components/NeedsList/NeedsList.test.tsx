import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { galleryNeeds, galleryNoNeeds } from '@/screens/dev-gallery/fixtures/rivalDesk';
import { useTracePanelStore } from '../Trace';
import { NeedsList } from './NeedsList';

afterEach(() => {
  useTracePanelStore.setState({ openPanelId: null });
});

describe('NeedsList', () => {
  it('lists each need in words with a severity bar and its Why?, most pressing first', () => {
    render(<NeedsList needs={galleryNeeds} />);

    const rows = within(screen.getByRole('list', { name: /Needs/ })).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'Champion has left: Gallery World Title',
      'Thin at main event: 1 of 2',
      'Short of referees: 2 of 3',
    ]);
    expect(
      screen.getByRole('meter', { name: 'Severity of Thin at main event: 1 of 2' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(
      screen.getByRole('button', { name: 'Why is Severity of Short of referees: 2 of 3 33?' }),
    ).toBeInTheDocument();
  });

  it('opens the slots line’s Why?', async () => {
    render(<NeedsList needs={galleryNeeds} />);

    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole('button', { name: /^Why is Wrestlers its largest show calls for/ }));

    expect(
      await screen.findByRole('dialog', { name: 'Wrestlers its largest show calls for' }),
    ).toBeInTheDocument();
  });

  it('says so when nothing is short', () => {
    render(<NeedsList needs={galleryNoNeeds} />);

    expect(screen.getByRole('heading', { name: 'No pressing needs' })).toBeInTheDocument();
    expect(screen.queryByRole('meter')).toBeNull();
  });
});
