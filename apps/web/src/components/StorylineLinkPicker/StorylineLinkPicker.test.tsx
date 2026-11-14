import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import {
  GALLERY_LINK_BASE,
  galleryAshfall,
  galleryHarbour,
  galleryFinaleElsewhereLinked,
  galleryHotLinked,
  galleryOther,
} from '@/screens/dev-gallery/fixtures/storylineLinks';
import type { GalleryLinkState } from '@/screens/dev-gallery/fixtures/storylineLinks';
import {
  limitText,
  LINK_ANOTHER_LABEL,
  NO_MEMBER_HERE_TEXT,
  NO_STORYLINES_TITLE,
  StorylineLinkPicker,
} from '.';

function renderPicker(state: Partial<GalleryLinkState> = {}) {
  const onLink = vi.fn();
  const onUnlink = vi.fn();
  const onSetFinale = vi.fn();
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <StorylineLinkPicker
            {...GALLERY_LINK_BASE}
            {...state}
            onLink={onLink}
            onUnlink={onUnlink}
            onSetFinale={onSetFinale}
          />
        ),
      },
    ],
    { initialEntries: ['/'], future: routerFutureFlags },
  );
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return { onLink, onUnlink, onSetFinale, user: userEvent.setup({ delay: null }) };
}

const LIMIT_STATE: Partial<GalleryLinkState> = {
  linked: [
    galleryHotLinked,
    { ...galleryAshfall, active: true, isFinale: false, finaleElsewhere: null },
  ],
  suggestions: [galleryHarbour],
};

describe('StorylineLinkPicker', () => {
  it('links a suggestion with one tap', async () => {
    const { onLink, user } = renderPicker();
    const chips = screen.getByRole('list', { name: 'Suggested storylines' });
    await user.click(
      within(chips).getByRole('button', { name: /^Link Gallery Ashfall Rivalry, 2 here, heat 54/ }),
    );
    expect(onLink).toHaveBeenCalledWith(galleryAshfall.storylineId);
  });

  it('unlinks and switches the finale from a linked row', async () => {
    const { onUnlink, onSetFinale, user } = renderPicker({ linked: [galleryHotLinked] });
    await user.click(screen.getByRole('switch', { name: `Finale of ${galleryHotLinked.name}` }));
    expect(onSetFinale).toHaveBeenCalledWith(galleryHotLinked.storylineId, true);
    await user.click(screen.getByRole('button', { name: `Unlink ${galleryHotLinked.name}` }));
    expect(onUnlink).toHaveBeenCalledWith(galleryHotLinked.storylineId);
  });

  it('leaves the Finale switch out for a talking segment', () => {
    renderPicker({ linked: [galleryHotLinked], canSetFinale: false });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(
      screen.getByRole('button', { name: `Unlink ${galleryHotLinked.name}` }),
    ).toBeInTheDocument();
  });

  it('names every control', () => {
    renderPicker({ linked: [galleryHotLinked] });
    for (const role of ['button', 'switch', 'combobox'] as const) {
      for (const control of screen.getAllByRole(role)) {
        expect(control).toHaveAccessibleName();
      }
    }
    expect(screen.getByRole('combobox', { name: LINK_ANOTHER_LABEL })).toBeInTheDocument();
  });

  it('turns the chips and the picker off at the limit and says why', () => {
    renderPicker(LIMIT_STATE);
    expect(screen.getByText(limitText(2))).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Suggested storylines' });
    for (const chip of within(chips).getAllByRole('button')) expect(chip).toBeDisabled();
    expect(screen.getByRole('combobox', { name: LINK_ANOTHER_LABEL })).toBeDisabled();
    // Unlinking still works at the limit.
    expect(screen.getByRole('button', { name: `Unlink ${galleryHotLinked.name}` })).toBeEnabled();
  });

  it('shows a disabled reason above a read-only list', () => {
    const reason = 'This show has run, so its storyline links can no longer change.';
    renderPicker({ linked: [galleryHotLinked], disabledReason: reason, canSetFinale: false });
    expect(screen.getByRole('status')).toHaveTextContent(reason);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText(galleryHotLinked.name)).toBeInTheDocument();
  });

  it('announces Hot on a heat meter at 82', () => {
    renderPicker({ linked: [galleryHotLinked] });
    const linked = screen.getByRole('list', { name: 'Linked storylines' });
    expect(within(linked).getByRole('meter', { name: 'Heat' })).toHaveAttribute(
      'aria-valuetext',
      '82, Hot',
    );
  });

  it("warns that a link with nobody in the segment won't count", () => {
    renderPicker({
      linked: [
        { ...galleryOther, active: true, membersHere: [], isFinale: false, finaleElsewhere: null },
      ],
    });
    expect(screen.getByText(NO_MEMBER_HERE_TEXT)).toBeInTheDocument();
  });

  it('says where the finale is when it is booked elsewhere', () => {
    renderPicker({ linked: [galleryFinaleElsewhereLinked] });
    expect(
      screen.getByText('Finale is currently Gallery Spring Spectacular, Slot 6'),
    ).toBeInTheDocument();
  });

  it('points to the Storylines desk when there are no storylines', () => {
    renderPicker({ suggestions: [], others: [], linked: [] });
    expect(screen.getByRole('heading', { name: NO_STORYLINES_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Storylines' })).toHaveAttribute(
      'href',
      '/game/storylines',
    );
  });
});
