import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { EmploymentStatus } from '@ringside/engine';
import { ContractDetailView, TERMS_PRIVATE_TEXT } from '../ContractDetailView';
import { aPrivateDetail, FIXTURE_EMPLOYMENT, FIXTURE_PROMOTION } from '../contractFixtures';
import { contractRulesOf } from '../useContractRules';
import { liveContractIds } from './liveContracts';

const RULES = contractRulesOf([], false);

describe('the profile’s Contract tab', () => {
  it('shows a rival’s promotion, kind and dates with "Terms private", and no money or morale', () => {
    render(
      <MemoryRouter>
        <ContractDetailView detail={aPrivateDetail()} rules={RULES} onAnswered={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText(TERMS_PRIVATE_TEXT)).toBeInTheDocument();
    expect(screen.getByText('Upper card wrestler at Test Promotion B')).toBeInTheDocument();
    expect(screen.getByText('Written')).toBeInTheDocument();
    expect(screen.queryByText(/\$/u)).toBeNull();
    expect(screen.queryByText('Morale')).toBeNull();
    expect(screen.queryByRole('button', { name: /Release/u })).toBeNull();
  });

  it('is shown for signed and active contracts, the viewer’s own first', () => {
    const rival = parseId('employment', 'emp_0000000002');
    const old = parseId('employment', 'emp_0000000003');
    const contract = (
      status: EmploymentStatus,
      promotionId: string,
      employmentId: typeof rival,
    ) => ({ employmentId, promotionId: parseId('promotion', promotionId), status });
    const profile = {
      career: {
        contracts: [
          contract('active', 'pro_0000000002', rival),
          contract('expired', FIXTURE_PROMOTION, old),
          contract('signed', FIXTURE_PROMOTION, FIXTURE_EMPLOYMENT),
        ],
      },
    };
    expect(liveContractIds(profile, FIXTURE_PROMOTION)).toEqual([FIXTURE_EMPLOYMENT, rival]);
    expect(liveContractIds({ career: { contracts: [] } }, null)).toEqual([]);
  });
});
