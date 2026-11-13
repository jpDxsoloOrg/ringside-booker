import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { SegmentAftermath } from '@ringside/engine';
import { routerFutureFlags } from '@/app/router';
import { useTracePanelStore } from '@/components/Trace';
import {
  FIXTURE_PROMOTION_NAME,
  fourWayAftermath,
  singlesUpsetAftermath,
} from './aftermathFixtures';
import { AFTERMATH_STALE_TEXT, popularityChangeText, regionWhyTrace } from './aftermathText';
import type { AftermathLevel } from './aftermathText';
import { AftermathView } from './AftermathView';

function Harness({
  aftermath,
  stale,
}: {
  readonly aftermath: SegmentAftermath;
  readonly stale: boolean;
}) {
  const [level, setLevel] = useState<AftermathLevel>('region');
  return (
    <AftermathView
      aftermath={aftermath}
      promotionName={FIXTURE_PROMOTION_NAME}
      level={level}
      onLevelChange={setLevel}
      stale={stale}
    />
  );
}

function renderView(aftermath: SegmentAftermath, stale = false) {
  render(
    <MemoryRouter future={routerFutureFlags}>
      <Harness aftermath={aftermath} stale={stale} />
    </MemoryRouter>,
  );
  return userEvent.setup({ delay: null });
}

/** The block of one worker. */
function workerBlock(name: string): HTMLElement {
  return screen.getByRole('article', { name });
}

/** The first column of every row of a worker's table. */
function placeNames(name: string): string[] {
  const table = within(workerBlock(name)).getByRole('grid');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelector('[data-column-id="name"]')?.textContent ?? '');
}

beforeEach(() => {
  useTracePanelStore.setState({ openPanelId: null });
});

describe('AftermathView', () => {
  it('shows each side with its result and each worker’s popularity and momentum', () => {
    renderView(singlesUpsetAftermath());

    const side1 = screen.getByRole('region', { name: 'Side 1' });
    expect(within(side1).getByText('Win')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Side 2' })).getByText('Loss'),
    ).toBeInTheDocument();

    const kara = workerBlock('Kara Voss');
    expect(within(kara).getByRole('link', { name: 'Kara Voss' })).toBeInTheDocument();
    const lines = within(kara).getAllByRole('paragraph');
    const popularity = lines.find((line) => line.textContent.startsWith('Popularity'));
    expect(popularity?.textContent).toContain('Northeast42→to46');
    expect(popularity?.textContent).toContain('+4');
    const momentum = lines.find((line) => line.textContent.startsWith('Momentum'));
    expect(momentum?.textContent).toContain('12→to22');
    expect(momentum?.textContent).toContain('+10');
    expect(
      within(kara).getByRole('button', { name: "Why is Kara Voss's momentum 22?" }),
    ).toBeInTheDocument();
  });

  it('keeps the neighbours folded away until asked, with reach rows always shown', async () => {
    const user = renderView(singlesUpsetAftermath());

    expect(placeNames('Kara Voss')).toEqual(['Northeast', 'Coastline']);
    const toggle = within(workerBlock('Kara Voss')).getByRole('button', {
      name: 'Neighbouring regions (2)',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(placeNames('Kara Voss')).toEqual(['Northeast', 'Lakeshore', 'Capital', 'Coastline']);
    // The other worker's table is left as it was.
    expect(placeNames('Rex Harlan')).toEqual(['Northeast', 'Coastline']);
    const table = within(workerBlock('Kara Voss')).getByRole('grid');
    expect(within(table).getByText('TV reach: Coastline Sports')).toBeInTheDocument();
  });

  it('explains a neighbour with the match change, the spill line and the limits', async () => {
    const user = renderView(singlesUpsetAftermath());
    await user.click(
      within(workerBlock('Kara Voss')).getByRole('button', { name: 'Neighbouring regions (2)' }),
    );

    await user.click(
      within(workerBlock('Kara Voss')).getByRole('button', {
        name: 'Why is Popularity in Lakeshore 43.6?',
      }),
    );

    const dialog = await screen.findByRole('dialog', { name: 'Popularity in Lakeshore' });
    expect(within(dialog).getByText(/Neighbour of Northeast/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Change asked for/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Popularity before/).length).toBeGreaterThan(0);
  });

  it('switches the table to countries and continents', async () => {
    const user = renderView(singlesUpsetAftermath());

    await user.click(screen.getByRole('radio', { name: 'Country' }));
    expect(placeNames('Kara Voss')).toEqual(['Norland', 'Eastmark']);
    expect(
      within(workerBlock('Kara Voss')).queryByRole('button', { name: /Neighbouring regions/ }),
    ).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'Continent' }));
    expect(placeNames('Kara Voss')).toEqual(['North Continent']);
  });

  it('notes a worker with no contract instead of a momentum', () => {
    renderView(fourWayAftermath());

    const sam = workerBlock('Sam Ortiz');
    expect(
      within(sam).getByText("No contract with Altura: momentum isn't tracked"),
    ).toBeInTheDocument();
    expect(within(sam).queryByRole('button', { name: /momentum/ })).toBeNull();
    expect(screen.getAllByRole('region', { name: /^Side / })).toHaveLength(4);
  });

  it('shows a change that rounds to nothing as flat', () => {
    renderView(fourWayAftermath());
    // Jo Tanaka's −0.02 rounds to 0 at one decimal.
    expect(popularityChangeText(-0.02)).toBe('0');
    const jo = workerBlock('Jo Tanaka');
    const flat = within(jo).getAllByText('0')[0]?.closest('[data-direction]');
    expect(flat).toHaveAttribute('data-direction', 'flat');
  });

  it('says when the setup changed after the Run', () => {
    renderView(singlesUpsetAftermath(), true);
    expect(screen.getByRole('status')).toHaveTextContent(AFTERMATH_STALE_TEXT);
  });

  it('never mentions morale', () => {
    renderView(fourWayAftermath());
    expect(document.body.textContent).not.toMatch(/morale/i);
  });

  it('opens each worker’s regions one at a time in a crowded match', async () => {
    const base = fourWayAftermath();
    const workers = [0, 1, 2].flatMap((copy) =>
      base.workers.map((worker, index) => ({
        ...worker,
        personId: parseId('person', `per_00000001${String(copy)}${String(index)}`),
        name: `${worker.name} ${String(copy + 1)}`,
        side: worker.side + copy * 4,
      })),
    );
    const user = renderView({ ...base, workers });

    expect(screen.queryAllByRole('grid')).toHaveLength(0);
    const block = workerBlock('Dee Lux 1');
    await user.click(within(block).getByRole('button', { name: 'Show every region' }));
    expect(screen.getAllByRole('grid')).toHaveLength(1);
    expect(placeNames('Dee Lux 1')).toEqual(['Northeast']);
  });
});

describe('regionWhyTrace', () => {
  it('puts the region’s reason on the door’s share step', () => {
    const neighbour = singlesUpsetAftermath().workers[0]?.popularity.regions[1];
    if (neighbour === undefined) throw new Error('The fixture lost its neighbour.');
    const share = regionWhyTrace(neighbour).children?.find((node) => node.kind === 'multiply');
    expect(share).toMatchObject({ label: 'Share for Lakeshore', reason: 'Neighbour of Northeast' });
  });

  it('puts the reason in front when the trace has no share step', () => {
    const neighbour = singlesUpsetAftermath().workers[0]?.popularity.regions[1];
    if (neighbour === undefined) throw new Error('The fixture lost its neighbour.');
    const why = regionWhyTrace({ ...neighbour, trace: { kind: 'input', label: 'x', value: 1 } });
    expect(why.children?.[0]).toMatchObject({ label: 'Neighbour of Northeast', value: 0.4 });
  });
});
