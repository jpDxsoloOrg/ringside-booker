import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { routes } from '@/app/routes';
import {
  galleryAcceptedValuation,
  galleryRefusedValuation,
} from '@/screens/dev-gallery/fixtures/networks';
import { OPEN_PRODUCTION_TEXT } from './networkText';
import { ProposalPreview } from './ProposalPreview';

describe('ProposalPreview: the camera refusal (ECO8-07)', () => {
  it('links the camera refusal to Production, and only that one', () => {
    render(
      <MemoryRouter>
        <ProposalPreview
          valuation={galleryRefusedValuation}
          kind="tv"
          networkName="National Sports Network"
        />
      </MemoryRouter>,
    );
    const reasons = screen.getByRole('list', { name: 'Why National Sports Network would refuse' });
    const items = within(reasons).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const camera = items.find((item) => item.textContent.includes('camera level'));
    expect(camera?.textContent).toContain('Raise your camera level in Production');
    const link = within(camera ?? reasons).getByRole('link', { name: OPEN_PRODUCTION_TEXT });
    expect(link.getAttribute('href')).toBe(routes.game.production());
    expect(within(reasons).getAllByRole('link')).toHaveLength(1);
  });

  it('has no Production link when the network would sign', () => {
    render(
      <MemoryRouter>
        <ProposalPreview
          valuation={galleryAcceptedValuation}
          kind="tv"
          networkName="Bluebonnet Cable 7"
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: OPEN_PRODUCTION_TEXT })).toBeNull();
  });
});
