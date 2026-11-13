import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useTracePanelStore } from '@/components/Trace';
import {
  galleryDrawResult,
  galleryLongNamesResult,
  galleryNewChampionResult,
  galleryResultTraceOf,
  galleryRetainedResult,
  gallerySummarisedResult,
  galleryWinResult,
} from '@/screens/dev-gallery/fixtures/rivalResults';
import type { GalleryResult } from '@/screens/dev-gallery/fixtures/rivalResults';
import { RivalResultLine } from './RivalResultLine';

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

function renderLine(result: GalleryResult) {
  render(
    <MemoryRouter>
      <RivalResultLine
        view={result.view}
        sides={result.sides}
        matchLabel={result.matchLabel}
        traceOf={galleryResultTraceOf}
      />
    </MemoryRouter>,
  );
  const line = document.querySelector<HTMLElement>('[data-part="rival-result"]');
  if (line === null) throw new Error('No result line drawn.');
  return { line, user: userEvent.setup({ delay: null }) };
}

describe('RivalResultLine', () => {
  it('says who beat whom, how, and why, with a Why? that opens the call', async () => {
    const { line, user } = renderLine(galleryWinResult);
    expect(line.querySelector('[data-part="outcome"]')).toHaveTextContent(
      'Kai Moreno def. Rex Hale',
    );
    expect(line.querySelector('[data-part="details"]')).toHaveTextContent(
      'Pinfall · Clean finish · Higher value',
    );
    // Single wrestlers link to their profile.
    expect(within(line).getByRole('link', { name: 'Kai Moreno' })).toBeInTheDocument();
    await user.click(
      within(line).getByRole('button', { name: 'Why this result? Kai Moreno vs Rex Hale' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Why this result? Kai Moreno vs Rex Hale' }),
    ).toBeInTheDocument();
  });

  it('says Draw for a draw, with no winner and no repeated reason', () => {
    const { line } = renderLine(galleryDrawResult);
    expect(line).toHaveAttribute('data-outcome', 'draw');
    expect(line.querySelector('[data-part="outcome"]')).toHaveTextContent(/^Draw$/);
    expect(line).not.toHaveTextContent(/def\./);
    expect(line.querySelector('[data-part="details"]')).toBeNull();
  });

  it('badges a retained title and a new champion, each with its own Why?', async () => {
    const retained = renderLine(galleryRetainedResult);
    const titles = within(retained.line).getByRole('list', { name: 'Titles on the line' });
    expect(within(titles).getByText('Retained')).toBeInTheDocument();
    expect(within(titles).queryByText('New champion')).toBeNull();
    await retained.user.click(
      within(titles).getByRole('button', { name: 'Why Retained? Coastal Heavyweight Title' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Why Retained? Coastal Heavyweight Title' }),
    ).toHaveTextContent('Change chance');
  });

  it('marks a new champion', () => {
    const { line } = renderLine(galleryNewChampionResult);
    const titles = within(line).getByRole('list', { name: 'Titles on the line' });
    expect(within(titles).getByText('New champion')).toBeInTheDocument();
    expect(within(titles).getByText('Contract ending')).toBeInTheDocument();
    expect(
      within(titles).getByRole('button', { name: 'Why New champion? Coastal Heavyweight Title' }),
    ).toBeInTheDocument();
    expect(line.querySelector('[data-part="outcome"]')).toHaveTextContent(
      'Dante Rivers def. Big Joe Sato',
    );
  });

  it('draws no Why? when the breakdown is no longer kept', () => {
    const { line } = renderLine(gallerySummarisedResult);
    expect(line).toHaveTextContent("The booker's full reasons are no longer kept");
    expect(within(line).queryByRole('button')).toBeNull();
  });

  it('names every losing side, linking only the lone wrestler', () => {
    const { line } = renderLine(galleryLongNamesResult);
    expect(line.querySelector('[data-part="outcome"]')).toHaveTextContent(
      'The Magnificent Brotherhood of the Eternal Steel Cage def. Running Axe Tactical Squadron and Maximilian Featherstonehaugh-Abernathy',
    );
    // A team is named, not linked; the lone wrestler is linked.
    expect(within(line).queryByRole('link', { name: /Magnificent Brotherhood/ })).toBeNull();
    expect(
      within(line).getByRole('link', { name: 'Maximilian Featherstonehaugh-Abernathy' }),
    ).toBeInTheDocument();
    expect(line.textContent).not.toContain(' ');
  });
});
