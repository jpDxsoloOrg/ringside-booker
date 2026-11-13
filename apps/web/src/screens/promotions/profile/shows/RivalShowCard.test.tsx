import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { ShowCardRow } from '@ringside/engine';
import {
  galleryAiredShow,
  galleryHiddenShow,
  galleryTraceOf,
} from '@/screens/dev-gallery/fixtures/rivalShowCards';
import { DETAILS_KEPT_TEXT, RivalShowCard, SEE_RESULTS_TEXT } from './RivalShowCard';

function renderCard(row: ShowCardRow) {
  render(
    <MemoryRouter>
      <RivalShowCard row={row} defaultExpanded traceOf={galleryTraceOf} />
    </MemoryRouter>,
  );
}

describe('RivalShowCard', () => {
  it('says only a summary is kept for a show that ran with none of its card left', () => {
    renderCard({ ...galleryAiredShow, slots: [] });
    expect(screen.getByText(DETAILS_KEPT_TEXT)).toBeInTheDocument();
    expect(screen.getByText(/^Show score/)).toHaveTextContent('Show score 72');
    expect(screen.getByRole('link', { name: SEE_RESULTS_TEXT })).toBeInTheDocument();
    expect(screen.queryByText('Open slot')).toBeNull();
  });

  it('has no score line or results link before the show has run', () => {
    renderCard(galleryHiddenShow);
    expect(screen.queryByText(/^Show score/)).toBeNull();
    expect(screen.queryByRole('link', { name: SEE_RESULTS_TEXT })).toBeNull();
  });
});
