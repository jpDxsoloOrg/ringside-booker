import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useTracePanelStore } from '@/components/Trace';
import {
  firstContinentId,
  GLOBAL_STAR_NAME,
  globalStarRollup,
  LOCAL_HERO_NAME,
  localHeroRollup,
  UNKNOWN_ROOKIE_NAME,
  unknownRookieRollup,
} from '@/screens/dev-gallery/fixtures/popularityRollups';
import { formatPopulation, PopularityDrilldown } from './PopularityDrilldown';

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

const ZERO_TOGGLE = /^Show places with no fans/;

function disclosure(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('PopularityDrilldown', () => {
  it('shows the worldwide figure and one closed row per continent', () => {
    render(<PopularityDrilldown rollup={globalStarRollup} subjectName={GLOBAL_STAR_NAME} />);

    expect(
      screen.getByRole('group', { name: `Popularity of ${GLOBAL_STAR_NAME} by place` }),
    ).toBeInTheDocument();
    expect(screen.getByText('Worldwide')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Why is Popularity worldwide/ }),
    ).toBeInTheDocument();
    const continents = within(screen.getByRole('list', { name: 'Continents' }));
    // Highest value first.
    expect(
      continents.getAllByRole('button', { expanded: false }).map((button) => button.textContent),
    ).toEqual(['Asia', 'Europe', 'North America']);
    expect(screen.getByRole('meter', { name: 'Popularity in Asia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Japan' })).not.toBeInTheDocument();
  });

  it('opens a continent into its countries and a country into its regions', async () => {
    const user = userEvent.setup();
    render(<PopularityDrilldown rollup={globalStarRollup} subjectName={GLOBAL_STAR_NAME} />);

    await user.click(disclosure('Asia'));
    expect(disclosure('Asia')).toHaveAttribute('aria-expanded', 'true');
    const countries = screen.getByRole('list', { name: 'Countries of Asia' });
    expect(disclosure('Asia')).toHaveAttribute('aria-controls', countries.id);
    expect(
      within(countries)
        .getAllByRole('button', { expanded: false })
        .map((button) => button.textContent),
    ).toEqual(['Japan', 'South Korea']);

    await user.click(disclosure('Japan'));
    const regions = within(screen.getByRole('list', { name: 'Regions of Japan' }));
    // Regions are listed by population, with the population as a muted figure and no Why?.
    expect(regions.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Kanto44M people94',
      'Kansai22M people88',
    ]);
    expect(regions.queryByRole('button')).not.toBeInTheDocument();
    expect(regions.getByRole('meter', { name: 'Popularity in Kanto' })).toHaveAttribute(
      'aria-valuenow',
      '94',
    );

    await user.click(disclosure('Asia'));
    expect(screen.queryByRole('list', { name: 'Countries of Asia' })).not.toBeInTheDocument();
  });

  it('starts with the given continents open', () => {
    render(
      <PopularityDrilldown
        rollup={localHeroRollup}
        subjectName={LOCAL_HERO_NAME}
        initiallyOpen={firstContinentId(localHeroRollup)}
      />,
    );

    expect(disclosure('North America')).toHaveAttribute('aria-expanded', 'true');
    expect(disclosure('United States')).toHaveAttribute('aria-expanded', 'false');
  });

  it('explains a country with its regions and their population shares', async () => {
    const user = userEvent.setup();
    render(
      <PopularityDrilldown
        rollup={localHeroRollup}
        subjectName={LOCAL_HERO_NAME}
        initiallyOpen={firstContinentId(localHeroRollup)}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Why is Popularity in United States/ }));

    const panel = within(
      await screen.findByRole('dialog', { name: 'Popularity in United States' }),
    );
    // Largest population first: Southeast 60M, Northeast 50M, Texas 30M of 140M.
    expect(panel.getByText(/42\.9% of the population/)).toBeInTheDocument();
    expect(panel.getByText(/35\.7% of the population/)).toBeInTheDocument();
    expect(panel.getByText(/21\.4% of the population/)).toBeInTheDocument();
    expect(panel.getAllByText(/Southeast/).length).toBeGreaterThan(0);
    expect(panel.getAllByText(/Northeast/).length).toBeGreaterThan(0);
    expect(panel.getAllByText(/Texas/).length).toBeGreaterThan(0);
  });

  it('hides places at 0 behind a toggle that counts them', async () => {
    const user = userEvent.setup();
    render(
      <PopularityDrilldown
        rollup={localHeroRollup}
        subjectName={LOCAL_HERO_NAME}
        initiallyOpen={firstContinentId(localHeroRollup)}
      />,
    );

    // Asia, Europe and their four countries, plus Canada.
    const toggle = screen.getByRole('button', { name: 'Show places with no fans (7)' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'Europe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Canada' })).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(disclosure('Europe')).toBeInTheDocument();
    expect(disclosure('Asia')).toBeInTheDocument();
    expect(disclosure('Canada')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByRole('button', { name: 'Europe' })).not.toBeInTheDocument();
  });

  it('keeps the toggle state to its own instance', async () => {
    const user = userEvent.setup();
    render(
      <>
        <PopularityDrilldown rollup={localHeroRollup} subjectName={LOCAL_HERO_NAME} />
        <PopularityDrilldown rollup={unknownRookieRollup} subjectName={UNKNOWN_ROOKIE_NAME} />
      </>,
    );

    const hero = within(screen.getByRole('group', { name: /Dusty Marlowe/ }));
    const rookie = within(screen.getByRole('group', { name: /Pip Calloway/ }));
    await user.click(rookie.getByRole('button', { name: ZERO_TOGGLE }));

    expect(rookie.getByRole('button', { name: 'Europe' })).toBeInTheDocument();
    expect(hero.queryByRole('button', { name: 'Europe' })).not.toBeInTheDocument();
    expect(hero.getByRole('button', { name: ZERO_TOGGLE })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('says so when the subject has no fans, and has no toggle when nothing is hidden', () => {
    const { unmount } = render(
      <PopularityDrilldown rollup={unknownRookieRollup} subjectName={UNKNOWN_ROOKIE_NAME} />,
    );
    expect(
      screen.getByText(`${UNKNOWN_ROOKIE_NAME} has no fans anywhere yet.`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Continents' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show places with no fans (9)' }),
    ).toBeInTheDocument();
    unmount();

    render(<PopularityDrilldown rollup={globalStarRollup} subjectName={GLOBAL_STAR_NAME} />);
    expect(screen.queryByRole('button', { name: ZERO_TOGGLE })).not.toBeInTheDocument();
  });

  it('toggles a disclosure from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup();
    render(<PopularityDrilldown rollup={globalStarRollup} subjectName={GLOBAL_STAR_NAME} />);

    disclosure('Europe').focus();
    await user.keyboard('{Enter}');
    expect(disclosure('Europe')).toHaveAttribute('aria-expanded', 'true');
    expect(disclosure('United Kingdom')).toBeInTheDocument();

    await user.keyboard(' ');
    expect(disclosure('Europe')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'United Kingdom' })).not.toBeInTheDocument();

    await user.keyboard(' ');
    disclosure('United Kingdom').focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('list', { name: 'Regions of United Kingdom' })).toBeInTheDocument();
  });

  it('passes the entity link renderer to the Why? panel', async () => {
    const user = userEvent.setup();
    render(
      <PopularityDrilldown
        rollup={localHeroRollup}
        subjectName={LOCAL_HERO_NAME}
        initiallyOpen={firstContinentId(localHeroRollup)}
        renderEntityLink={(ref, label) => <a href={`#${ref.kind}`}>{label}</a>}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^Why is Popularity in United States/ }));
    const panel = within(
      await screen.findByRole('dialog', { name: 'Popularity in United States' }),
    );
    // The region inputs sit inside each region's line, which starts closed.
    await user.click(panel.getByRole('button', { name: 'Expand all' }));
    expect(panel.getByRole('link', { name: 'Popularity in Southeast' })).toHaveAttribute(
      'href',
      '#region',
    );
  });
});

describe('formatPopulation', () => {
  it('shortens millions and thousands', () => {
    expect(formatPopulation(12_300_000)).toBe('12.3M people');
    expect(formatPopulation(44_000_000)).toBe('44M people');
    expect(formatPopulation(850_000)).toBe('850K people');
    expect(formatPopulation(420)).toBe('420 people');
  });
});
