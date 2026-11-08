import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OfficeScreen } from './OfficeScreen';
import {
  sampleCard,
  sampleChampionships,
  sampleKpis,
  sampleRosterLeaders,
} from './sampleDashboard';

function renderOffice(): void {
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <OfficeScreen />
    </MemoryRouter>,
  );
}

describe('OfficeScreen (placeholder dashboard)', () => {
  it('is titled Dashboard and says plainly that it shows sample data', async () => {
    renderOffice();

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Placeholder')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      'Every name and number on this page is invented',
    );
    await waitFor(() => {
      expect(document.title).toBe('Dashboard · Ringside Booker');
    });
  });

  it('shows a KPI card for every sample number', () => {
    renderOffice();

    const grid = screen.getByRole('group', { name: 'Key numbers' });
    for (const kpi of sampleKpis) {
      expect(
        within(grid).getByRole('group', { name: new RegExp(kpi.label, 'i') }),
      ).toBeInTheDocument();
    }
  });

  it('shows the upcoming card with every slot, including the open one', () => {
    renderOffice();

    expect(
      screen.getByRole('heading', { level: 2, name: 'Longleaf Saturday Night' }),
    ).toBeInTheDocument();
    const card = screen.getByRole('list', { name: 'Card' });
    expect(card.querySelectorAll(':scope > li')).toHaveLength(sampleCard.length);
    expect(within(card).getByText('Open slot')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage card' })).toHaveAttribute(
      'href',
      '/game/booking',
    );
  });

  it('shows the champions, the last show and the roster leaders', () => {
    renderOffice();

    const champions = screen.getByRole('region', { name: 'Champions' });
    expect(within(champions).getAllByRole('article')).toHaveLength(sampleChampionships.length);
    expect(screen.getByRole('group', { name: 'Last show' })).toBeInTheDocument();
    const table = screen.getByRole('grid', { name: 'Roster leaders' });
    // One header row plus a row per leader.
    expect(within(table).getAllByRole('row')).toHaveLength(sampleRosterLeaders.length + 1);
  });
});
