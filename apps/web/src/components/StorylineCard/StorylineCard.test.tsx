import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { StorylineRow } from '@ringside/engine';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import {
  GALLERY_HOT_FROM,
  galleryColdStoryline,
  galleryHotStoryline,
  galleryLeftStoryline,
  galleryRivalStoryline,
} from '@/screens/dev-gallery/fixtures/storylines';
import { HEAT_NOT_PUBLIC_TEXT, LEFT_PROMOTION_TEXT, StorylineCard, storylineFooterFacts } from '.';

function renderCard(row: StorylineRow) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <StorylineCard row={row} hotFrom={GALLERY_HOT_FROM} href="/story" />,
      },
    ],
    { initialEntries: ['/'], future: routerFutureFlags },
  );
  return render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
}

describe('StorylineCard', () => {
  it('links the name, lists faces and heels apart and draws the heat meter with its number', () => {
    renderCard(galleryHotStoryline);
    const card = screen.getByRole('article', { name: galleryHotStoryline.name });
    expect(within(card).getByRole('link', { name: galleryHotStoryline.name })).toHaveAttribute(
      'href',
      '/story',
    );
    expect(within(card).getByText('Gallery Mainstage')).toBeInTheDocument();
    const faces = within(card).getByRole('list', { name: 'Faces' });
    const heels = within(card).getByRole('list', { name: 'Heels' });
    expect(within(faces).getByText('Gallery Name One')).toBeInTheDocument();
    expect(within(heels).getByText('Gallery Name Three')).toBeInTheDocument();
    expect(
      within(within(card).getByRole('list', { name: 'Neutral' })).getByText('Gallery Referee'),
    ).toBeInTheDocument();
    const meter = within(card).getByRole('meter', { name: /Heat/ });
    expect(meter).toHaveAttribute('aria-valuenow', '84');
    expect(meter).toHaveAttribute('aria-valuetext', '84, Hot');
    expect(within(card).getByText('Hot')).toBeInTheDocument();
    expect(within(card).getByText('84')).toBeInTheDocument();
  });

  it("links every member's name to their profile (CRTV3-05)", () => {
    renderCard(galleryHotStoryline);
    const card = screen.getByRole('article', { name: galleryHotStoryline.name });
    for (const member of [
      ...galleryHotStoryline.faces,
      ...galleryHotStoryline.heels,
      ...galleryHotStoryline.neutrals,
    ]) {
      expect(within(card).getByRole('link', { name: member.name })).toHaveAttribute(
        'href',
        routes.game.worker(member.personId),
      );
    }
  });

  it('draws no meter for a rival storyline and says its heat is not public', () => {
    renderCard(galleryRivalStoryline);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText(HEAT_NOT_PUBLIC_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/^Started/)).toHaveTextContent(/^Started [^·]+$/);
  });

  it('says Hot only from the hot threshold up', () => {
    renderCard(galleryColdStoryline);
    expect(screen.queryByText('Hot')).toBeNull();
  });

  it('warns about a member who left the promotion, and leaves the rest alone', () => {
    renderCard(galleryLeftStoryline);
    const heels = screen.getByRole('list', { name: 'Heels' });
    expect(within(heels).getByText(LEFT_PROMOTION_TEXT)).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Faces' })).queryByText(LEFT_PROMOTION_TEXT),
    ).toBeNull();
  });

  it('says the footer facts in plain words', () => {
    expect(storylineFooterFacts(galleryColdStoryline)).toEqual([
      'Started Jan 4, 2027',
      '1 linked segment',
      '26 days since it moved on',
    ]);
  });

  it('writes no inline styles', () => {
    const { container } = renderCard(galleryHotStoryline);
    expect(container.querySelector('[style]')).toBeNull();
  });
});
