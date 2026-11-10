import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays } from '@ringside/engine';
import type { CalendarShow, CalendarShowDetail } from '@ringside/engine';
import { useTracePanelStore } from '@/components/Trace';
import {
  GALLERY_CALENDAR_TODAY,
  galleryRivalShow,
  galleryShow,
  galleryShowDetail,
} from '@/screens/dev-gallery/fixtures/calendar';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { registerShowSheetAction, registerShowSheetSection } from './registry';
import { ShowDetailSheet } from './ShowDetailSheet';
import type { ShowDetailSheetProps } from './ShowDetailSheet';

const NEXT_WEEK = addDays(GALLERY_CALENDAR_TODAY, 7);

const cleanups: (() => void)[] = [];

beforeEach(() => {
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  act(() => {
    for (const unregister of cleanups.splice(0)) unregister();
  });
});

function renderSheet(
  show: CalendarShow | CalendarShowDetail | null,
  props: Partial<ShowDetailSheetProps> = {},
) {
  const onClose = vi.fn();
  render(
    <ShowDetailSheet
      open
      onClose={onClose}
      show={show}
      today={GALLERY_CALENDAR_TODAY}
      showPromotion={false}
      {...props}
    />,
  );
  return { onClose, user: userEvent.setup() };
}

/** The value beside a fact's term. */
function fact(term: string): HTMLElement {
  const value = screen.getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`The fact "${term}" has no value.`);
  return value;
}

describe('ShowDetailSheet', () => {
  it('is a dialog named by the show, with every fact', () => {
    const show = galleryShowDetail(
      galleryShow({
        date: NEXT_WEEK,
        airDate: addDays(NEXT_WEEK, 2),
        importance: 'major',
        format: { slots: 8, preShowSlots: 1 },
      }),
    );
    renderSheet(show);

    expect(screen.getByRole('dialog', { name: 'Altura Overclock' })).toBeInTheDocument();
    expect(fact('Date')).toHaveTextContent('Wednesday, January 13, 2027');
    expect(fact('Date')).toHaveTextContent('Airs Friday, January 15, 2027');
    expect(fact('Brand')).toHaveTextContent('Overclock');
    expect(fact('Importance')).toHaveTextContent('Major');
    expect(fact('Card')).toHaveTextContent('8 main slots + 1 pre-show');
    expect(fact('Television')).toHaveTextContent('Televised');
    expect(fact('Runs')).toHaveTextContent('Every Wednesday');
    expect(fact('Region')).toHaveTextContent('Altura Valley, Meridia');
    expect(fact('Venue')).toHaveTextContent('Altura Civic Arena (holds 12,400)');
    expect(fact('Status')).toHaveTextContent('Scheduled');
    expect(screen.queryByText('Promotion', { selector: 'dt' })).not.toBeInTheDocument();
  });

  it('leaves the airing line out when the show airs the day it runs', () => {
    renderSheet(galleryShowDetail(galleryShow({ date: NEXT_WEEK, airDate: NEXT_WEEK })));
    expect(fact('Date')).toHaveTextContent(/^Wednesday, January 13, 2027$/);
  });

  it('names the promotion when the calendar lists every promotion’s shows', () => {
    renderSheet(galleryShowDetail(galleryRivalShow(0)), { showPromotion: true });
    expect(fact('Promotion')).toHaveTextContent('Harbour City Pro');
    expect(fact('Brand')).toHaveTextContent('Whole promotion');
  });

  it('says a show is not televised, and leaves television out for a one-off', () => {
    const { rerender } = render(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={galleryShowDetail(galleryShow({ televised: false }))}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    expect(fact('Television')).toHaveTextContent('Not televised');

    rerender(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={galleryShowDetail(galleryShow({ televised: null, definitionId: null }), {
          definition: null,
          placementTrace: null,
        })}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    expect(screen.queryByText('Television', { selector: 'dt' })).not.toBeInTheDocument();
    expect(fact('Runs')).toHaveTextContent('One-off show');
  });

  it('says the venue is not chosen yet', () => {
    renderSheet(galleryShowDetail(galleryShow({ venue: null })));
    expect(fact('Venue')).toHaveTextContent('Venue not chosen yet');
    expect(
      within(fact('Venue')).getByRole('button', { name: 'Why is the venue not chosen yet?' }),
    ).toBeInTheDocument();
  });

  it('explains where the show is held when the engine gives its reasoning', async () => {
    const { user } = renderSheet(galleryShowDetail(galleryShow()));
    await user.click(
      within(fact('Venue')).getByRole('button', { name: 'Why is the venue Altura Civic Arena?' }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Where the show is held' });
    expect(within(panel).getByText(/The show has a preferred venue/)).toBeInTheDocument();
  });

  it('has no Why? on the venue without the reasoning', () => {
    renderSheet(galleryShowDetail(galleryShow(), { placementTrace: null }));
    expect(within(fact('Venue')).queryByRole('button')).not.toBeInTheDocument();
  });

  it('draws a projected show from its row, with no way to act on it', () => {
    renderSheet(galleryShow({ status: 'projected', canCancel: false }), {
      onCancelShow: vi.fn(),
    });
    expect(fact('Status')).toHaveTextContent('Projected: not on the schedule yet');
    expect(screen.getByText(/past the stored schedule/)).toBeInTheDocument();
    expect(screen.queryByText('Runs', { selector: 'dt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel show' })).not.toBeInTheDocument();
  });

  it('reads cancelled and not-run shows correctly', () => {
    const { rerender } = render(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={galleryShow({
          status: 'cancelled',
          cancellation: { reason: 'byPromotion', on: GALLERY_CALENDAR_TODAY },
          canCancel: false,
        })}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    expect(fact('Status')).toHaveTextContent('Cancelled by you on Wed 6 Jan 2027');

    rerender(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={galleryShow({
          status: 'cancelled',
          cancellation: { reason: 'notRun', on: GALLERY_CALENDAR_TODAY },
          canCancel: false,
        })}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    expect(fact('Status')).toHaveTextContent('Not run (no card)');
  });

  it('says so while the show loads and when there is no such show', () => {
    const { rerender } = render(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={null}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Loading show' })).toBeInTheDocument();

    rerender(
      <ShowDetailSheet
        open
        onClose={() => undefined}
        show={null}
        gap="notFound"
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Show not found' });
    expect(within(dialog).getByText('That show no longer exists')).toBeInTheDocument();
  });

  it('renders nothing while closed and asks to close from the Close button', async () => {
    const { onClose, user } = renderSheet(galleryShow());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();

    render(
      <ShowDetailSheet
        open={false}
        onClose={() => undefined}
        show={galleryShow({ name: 'Hidden Show' })}
        today={GALLERY_CALENDAR_TODAY}
        showPromotion={false}
      />,
    );
    expect(screen.queryByRole('dialog', { name: 'Hidden Show' })).not.toBeInTheDocument();
  });

  it('never says how long the show runs', () => {
    renderSheet(
      galleryShowDetail(
        galleryShow({ airDate: addDays(GALLERY_CALENDAR_TODAY, 3), importance: 'minor' }),
      ),
      { showPromotion: true, onCancelShow: vi.fn() },
    );
    expect(document.body.textContent).not.toMatch(RUNNING_TIME_WORDS);
  });

  describe('Cancel show', () => {
    it('is offered only for a show the viewer can cancel', () => {
      const onCancelShow = vi.fn();
      const { rerender } = render(
        <ShowDetailSheet
          open
          onClose={() => undefined}
          show={galleryShow()}
          today={GALLERY_CALENDAR_TODAY}
          showPromotion={false}
          onCancelShow={onCancelShow}
        />,
      );
      expect(screen.getByRole('button', { name: 'Cancel show' })).toBeInTheDocument();

      for (const show of [
        galleryRivalShow(0),
        galleryShow({ status: 'completed', canCancel: false }),
        galleryShow({ date: addDays(GALLERY_CALENDAR_TODAY, -3), canCancel: false }),
      ]) {
        rerender(
          <ShowDetailSheet
            open
            onClose={() => undefined}
            show={show}
            today={GALLERY_CALENDAR_TODAY}
            showPromotion={false}
            onCancelShow={onCancelShow}
          />,
        );
        expect(screen.queryByRole('button', { name: 'Cancel show' })).not.toBeInTheDocument();
      }
    });

    it('asks first, naming the show and its date, and keeps the show when told to', async () => {
      const onCancelShow = vi.fn();
      const { user } = renderSheet(galleryShow({ date: NEXT_WEEK, airDate: NEXT_WEEK }), {
        onCancelShow,
      });
      await user.click(screen.getByRole('button', { name: 'Cancel show' }));

      const confirm = await screen.findByRole('alertdialog', {
        name: 'Cancel Altura Overclock on Wed 13 Jan 2027?',
      });
      expect(confirm).toHaveTextContent("This can't be undone; the date stays empty.");
      await user.click(within(confirm).getByRole('button', { name: 'Keep show' }));

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(onCancelShow).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Altura Overclock' })).toBeInTheDocument();
    });

    it('cancels on confirm and leaves the sheet open', async () => {
      const show = galleryShow({ date: NEXT_WEEK, airDate: NEXT_WEEK });
      const onCancelShow = vi.fn(async () => {
        await Promise.resolve();
      });
      const { onClose, user } = renderSheet(show, { onCancelShow });
      await user.click(screen.getByRole('button', { name: 'Cancel show' }));
      const confirm = await screen.findByRole('alertdialog');
      await user.click(within(confirm).getByRole('button', { name: 'Cancel show' }));

      await waitFor(() => {
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
      expect(onCancelShow).toHaveBeenCalledExactlyOnceWith(show);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Altura Overclock' })).toBeInTheDocument();
    });

    it('shows the game’s reason in the confirmation when it refuses', async () => {
      const onCancelShow = vi.fn(async () => {
        await Promise.resolve();
        throw new Error('This show has already taken place.');
      });
      const { user } = renderSheet(galleryShow(), { onCancelShow });
      await user.click(screen.getByRole('button', { name: 'Cancel show' }));
      const confirm = await screen.findByRole('alertdialog');
      await user.click(within(confirm).getByRole('button', { name: 'Cancel show' }));

      expect(await within(confirm).findByRole('alert')).toHaveTextContent(
        'This show has already taken place.',
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });
  });

  describe('slots', () => {
    it('draws registered actions in the footer, in order, with the show’s context', () => {
      const contexts: unknown[] = [];
      act(() => {
        cleanups.push(
          registerShowSheetAction({
            id: 'test.venue',
            order: 20,
            render: () => <button type="button">Pick a venue</button>,
          }),
          registerShowSheetAction({
            id: 'test.book',
            order: 10,
            render: (context) => {
              contexts.push(context);
              return context.isOwn ? <button type="button">Book this show</button> : null;
            },
          }),
        );
      });
      const show = galleryShow();
      renderSheet(show, { onCancelShow: vi.fn() });

      const dialog = screen.getByRole('dialog', { name: 'Altura Overclock' });
      const footer = dialog.querySelector('[data-sheet-footer]');
      if (!(footer instanceof HTMLElement)) throw new Error('The sheet has no footer.');
      expect(
        within(footer)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['Book this show', 'Pick a venue', 'Cancel show']);
      expect(contexts.at(-1)).toEqual({ show, isOwn: true, today: GALLERY_CALENDAR_TODAY });
    });

    it('leaves out an action that draws nothing, and the footer when nothing is in it', () => {
      act(() => {
        cleanups.push(
          registerShowSheetAction({
            id: 'test.book',
            order: 10,
            render: ({ isOwn }) => (isOwn ? <button type="button">Book this show</button> : null),
          }),
        );
      });
      renderSheet(galleryRivalShow(0));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).queryByRole('button', { name: 'Book this show' })).toBeNull();
      expect(dialog.querySelector('[data-sheet-footer]')).toBeNull();
    });

    it('draws registered sections under the facts and removes them on unregister', () => {
      renderSheet(galleryShow());
      expect(screen.queryByRole('region', { name: 'Airing' })).not.toBeInTheDocument();

      let removeAiring: () => void = () => undefined;
      act(() => {
        removeAiring = registerShowSheetSection({
          id: 'test.airing',
          order: 10,
          title: 'Airing',
          render: ({ show }) => <p>Airs on Test Network: {show.name}</p>,
        });
        cleanups.push(
          registerShowSheetSection({
            id: 'test.empty',
            order: 20,
            title: 'Nothing to say',
            render: () => null,
          }),
        );
      });
      const section = screen.getByRole('region', { name: 'Airing' });
      expect(section).toHaveTextContent('Airs on Test Network: Altura Overclock');
      expect(screen.queryByRole('region', { name: 'Nothing to say' })).not.toBeInTheDocument();

      act(() => {
        removeAiring();
      });
      expect(screen.queryByRole('region', { name: 'Airing' })).not.toBeInTheDocument();
    });

    it('removes a registered action on unregister', () => {
      let removeAction: () => void = () => undefined;
      act(() => {
        removeAction = registerShowSheetAction({
          id: 'test.tape',
          order: 10,
          render: () => <button type="button">Tape on another day</button>,
        });
      });
      renderSheet(galleryShow());
      expect(screen.getByRole('button', { name: 'Tape on another day' })).toBeInTheDocument();
      act(() => {
        removeAction();
      });
      expect(screen.queryByRole('button', { name: 'Tape on another day' })).not.toBeInTheDocument();
    });
  });
});
