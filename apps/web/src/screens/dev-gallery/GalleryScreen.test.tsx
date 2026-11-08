import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { appRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { setMatchMedia } from '@/test/matchMedia';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { applyTheme } from '@/styles/theme';
import { generatePeople, generatePromotions, generateTitles } from './artSamples';
import { galleryEntries } from './entries';
import { nextSeed, rollDice } from './entries/engine.gallery';

function renderGallery(path = '/dev/gallery'): ReturnType<typeof createMemoryRouter> {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
  return router;
}

function entryHeading(title: string): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: title });
}

afterEach(() => {
  // Unmount first, so resetting the theme does not update a gallery that is still mounted.
  cleanup();
  applyTheme('system');
});

describe('GalleryScreen', () => {
  it('shows the first entry when the URL has no hash', async () => {
    renderGallery();

    await screen.findByRole('heading', { level: 1, name: 'Component gallery' });
    const [firstEntry] = galleryEntries;
    expect(entryHeading(firstEntry?.title ?? '')).toBeInTheDocument();
  });

  it('opens the entry a #hash names', async () => {
    renderGallery('/dev/gallery#stat-bar');
    expect(await screen.findByRole('heading', { level: 2, name: 'StatBar' })).toBeInTheDocument();
  });

  it('falls back to the first entry for an unknown hash', async () => {
    renderGallery('/dev/gallery#no-such-entry');
    await screen.findByRole('heading', { level: 1, name: 'Component gallery' });
    expect(entryHeading(galleryEntries[0]?.title ?? '')).toBeInTheDocument();
  });

  it('switches entries from the list and marks the current one', async () => {
    const user = userEvent.setup();
    const router = renderGallery('/dev/gallery#button');
    const entryList = await screen.findByRole('navigation', { name: 'Gallery entries' });

    await user.click(within(entryList).getByRole('link', { name: 'Badge' }));

    expect(router.state.location.hash).toBe('#badge');
    expect(entryHeading('Badge')).toBeInTheDocument();
    expect(within(entryList).getByRole('link', { name: 'Badge' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('switches entries from the phone select', async () => {
    const user = userEvent.setup();
    const router = renderGallery('/dev/gallery#button');

    await user.selectOptions(await screen.findByLabelText('Entry'), 'engine');

    expect(router.state.location.hash).toBe('#engine');
    expect(entryHeading('Engine in the browser')).toBeInTheDocument();
  });

  it('applies the theme buttons to the document', async () => {
    const user = userEvent.setup();
    renderGallery();

    await user.click(await screen.findByRole('button', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('puts the entry in a 390px phone frame on desktop', async () => {
    const user = userEvent.setup();
    renderGallery('/dev/gallery#badge');

    await user.click(await screen.findByRole('button', { name: 'Phone frame' }));

    const frame = screen.getByTitle('Badge at phone width');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', '/dev/gallery/frame?theme=system#badge');
  });

  it('never shows the phone frame at phone width', async () => {
    const user = userEvent.setup();
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    renderGallery('/dev/gallery#badge');

    await user.click(await screen.findByRole('button', { name: 'Phone frame' }));

    expect(screen.queryByTitle('Badge at phone width')).not.toBeInTheDocument();
    expect(entryHeading('Badge')).toBeInTheDocument();
  });

  it.each(galleryEntries.map((entry) => [entry.id, entry.title]))(
    'renders the %s entry',
    async (entryId, title) => {
      renderGallery(`/dev/gallery#${entryId}`);
      expect(await screen.findByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    },
  );
});

describe('gallery frame page', () => {
  it('shows only the entry and applies the requested theme', async () => {
    renderGallery('/dev/gallery/frame?theme=dark#button');

    expect(await screen.findByRole('heading', { level: 1, name: 'Button' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});

describe('art entries', () => {
  it('regenerates to a new seed', async () => {
    const user = userEvent.setup();
    renderGallery('/dev/gallery#art-people');
    expect(await screen.findByText('gallery-art-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));

    expect(screen.getByText('gallery-art-2')).toBeInTheDocument();
  });

  it('generates the same subjects for a seed, and new ones for the next', () => {
    expect(generatePeople(1, 6)).toEqual(generatePeople(1, 6));
    expect(generatePeople(2, 6)).not.toEqual(generatePeople(1, 6));
    expect(generateTitles(1, 8).map((title) => title.tier)).toEqual([
      'gold',
      'silver',
      'bronze',
      'plain',
      'gold',
      'silver',
      'bronze',
      'plain',
    ]);
    expect(generatePromotions(3, 4).every((promotion) => promotion.kind === 'promotion')).toBe(
      true,
    );
  });
});

describe('engine entry', () => {
  it('rolls twenty dice from 1 to 6 that replay for a seed', () => {
    const rolls = rollDice('ringside-1');
    expect(rolls).toHaveLength(20);
    expect(rolls.every((roll) => roll >= 1 && roll <= 6)).toBe(true);
    expect(rollDice('ringside-1')).toEqual(rolls);
    expect(rollDice('ringside-2')).not.toEqual(rolls);
  });

  it('steps the seed', () => {
    expect(nextSeed('ringside-1')).toBe('ringside-2');
    expect(nextSeed('seed9')).toBe('seed10');
    expect(nextSeed('plain')).toBe('plain-2');
  });

  it('moves to the next seed from the button', async () => {
    const user = userEvent.setup();
    renderGallery('/dev/gallery#engine');

    const seedInput = await screen.findByLabelText('Seed');
    expect(seedInput).toHaveValue('ringside-1');
    await user.click(screen.getByRole('button', { name: 'Next seed' }));
    expect(seedInput).toHaveValue('ringside-2');
    expect(screen.getByText('Same seed, same rolls')).toBeInTheDocument();
  });
});

describe('theme state', () => {
  it('follows data-theme changes made outside the gallery', async () => {
    renderGallery('/dev/gallery#tokens-colours');
    await screen.findByText(/Showing the light theme/);

    await act(async () => {
      applyTheme('dark');
      // The MutationObserver reports on a later tick; let it run inside act.
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(await screen.findByText(/Showing the dark theme/)).toBeInTheDocument();
  });
});
