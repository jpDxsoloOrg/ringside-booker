import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EmploymentId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';

import { ContractDetailView } from '../ContractDetailView';
import { ReleaseDialog } from '../ReleaseDialog';
import { useContractRules } from '../useContractRules';
import styles from '../ContractsScreen.module.css';
import { useContractMoney } from '../useContractMoney';

/** The Contracts screen with this contract open, on the tab it belongs to. */
export function contractLink(employmentId: EmploymentId): string {
  return `${routes.game.contracts()}?tab=active&employment=${employmentId}`;
}

function OneContract({ employmentId }: { readonly employmentId: EmploymentId }) {
  const rules = useContractRules();
  const money = useContractMoney();
  const query = useEngineQuery('contracts.detail', { employmentId });
  const [releasing, setReleasing] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const detail = query.status === 'success' ? (query.data ?? null) : null;

  if (query.status === 'loading') return <p role="status">Loading the contract…</p>;
  if (detail === null) {
    return <div role="status">{outcome ?? <p>That contract could not be found.</p>}</div>;
  }
  const own = detail.termsPrivate ? null : detail;
  const live = detail.status === 'active' || detail.status === 'signed';

  return (
    <section className={styles['detail']} aria-label={`Contract with ${detail.promotionName}`}>
      <ContractDetailView
        detail={detail}
        rules={rules}
        onAnswered={(result) => {
          setOutcome(
            result.answer === 'grant'
              ? `Let ${detail.ringName} go. Severance ${money(result.severance)}`
              : `Refused ${detail.ringName}'s request to leave.`,
          );
        }}
      />
      <div role="status">{outcome !== null && <p>{outcome}</p>}</div>
      <div className={styles['sheetFooter']}>
        {own !== null && live && own.request?.status !== 'open' && (
          <Button
            variant="danger"
            onClick={() => {
              setReleasing(true);
            }}
          >
            {own.status === 'signed' ? 'Call off deal' : 'Release'}
          </Button>
        )}
        {own !== null && (
          <Link to={contractLink(detail.employmentId)} className={styles['profileLink']}>
            Open in Contracts
          </Link>
        )}
      </div>
      {own !== null && (
        <ReleaseDialog
          open={releasing}
          employmentId={own.employmentId}
          ringName={own.ringName}
          onClose={() => {
            setReleasing(false);
          }}
          onReleased={(result) => {
            setReleasing(false);
            setOutcome(`Released ${own.ringName}. Severance ${money(result.severance)}`);
          }}
        />
      )}
    </section>
  );
}

/**
 * The worker profile's Contract tab: each signed or active contract, your own with every term,
 * Release and any request to leave, a rival's with only the promotion, kind and dates.
 */
export function ContractSummary({
  employmentIds,
}: {
  readonly employmentIds: readonly EmploymentId[];
}) {
  return (
    <div className={styles['detail']}>
      {employmentIds.map((employmentId) => (
        <OneContract key={employmentId} employmentId={employmentId} />
      ))}
    </div>
  );
}
