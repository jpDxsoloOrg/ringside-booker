import { useSearchParams } from 'react-router-dom';
import type { ContractRow, EmploymentId, PersonId, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useSessionStore } from '@/app/session/sessionStore';
import { Button } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { WhyButton } from '@/components/Trace';
import { searchWithEmployment, searchWithNegotiation } from '../contractsParams';
import type { NegotiationTarget } from '../contractsParams';
import type { ContractRowActionProps } from '../rowActions';
import { useContractRules } from '../useContractRules';
import styles from '../ContractsScreen.module.css';

/** "Talks open 180 days before the contract ends". */
export function renewalWindowText(windowDays: number): string {
  return `Talks open ${formatNumber(windowDays)} days before the contract ends`;
}

/** Whether a contract is one Renew applies to: yours, live and with an end date. */
export function isRenewable(row: ContractRow, promotionId: PromotionId | null): boolean {
  return (
    row.promotionId === promotionId &&
    (row.status === 'active' || row.status === 'signed') &&
    row.endsOn !== null
  );
}

/** Whether today is inside the renewal window for the contract. */
export function insideRenewalWindow(
  row: Pick<ContractRow, 'daysLeft'>,
  windowDays: number,
): boolean {
  return row.daysLeft !== null && row.daysLeft <= windowDays;
}

/** Your open renewal talks with this worker, if any. */
function useOpenRenewal(promotionId: PromotionId, personId: PersonId): NegotiationTarget | null {
  const offers = useEngineQuery('contracts.offers', { promotionId, status: 'open' });
  const open = offers.data?.find((row) => row.personId === personId && row.kind === 'renewal');
  return open === undefined ? null : { kind: 'talks', negotiationId: open.negotiationId };
}

/**
 * Renew (ECO5-06), on a contract's sheet and on each Expiring row: opens the Negotiation Sheet for
 * a renewal, or the renewal talks already open. Outside the renewal window it is disabled with
 * "Talks open 180 days before the contract ends"; a worker too unhappy to renew disables it with
 * "Won't renew while unhappy here" and a Why? on their willingness. Reasons are written out, never
 * left to a tooltip.
 */
export function RenewAction({ row, placement }: ContractRowActionProps) {
  const rules = useContractRules();
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  if (promotionId === null) return null;
  if (!insideRenewalWindow(row, rules.renewalWindowDays)) {
    return (
      <span className={styles['disabledAction']}>
        <Button size={placement === 'row' ? 'sm' : 'md'} variant="secondary" disabled>
          Renew
        </Button>
        <span className={styles['reason']}>{renewalWindowText(rules.renewalWindowDays)}</span>
      </span>
    );
  }
  return (
    <RenewInsideWindow
      row={row}
      placement={placement}
      promotionId={promotionId}
      employmentId={row.employmentId}
    />
  );
}

function RenewInsideWindow({
  row,
  placement,
  promotionId,
  employmentId,
}: ContractRowActionProps & {
  readonly promotionId: PromotionId;
  readonly employmentId: EmploymentId;
}) {
  const [, setSearchParams] = useSearchParams();
  const talks = useOpenRenewal(promotionId, row.personId);
  const ask = useEngineQuery('contracts.askingTerms', {
    promotionId,
    personId: row.personId,
    renewalOf: employmentId,
  });
  const refusal = ask.data?.refusal ?? null;
  const size = placement === 'row' ? 'sm' : 'md';
  if (talks === null && refusal !== null) {
    const decision = ask.data?.renewalDecision ?? null;
    return (
      <span className={styles['disabledAction']}>
        <Button size={size} variant="secondary" disabled>
          Renew
        </Button>
        <span className={styles['reason']}>{refusal.message}</span>
        {decision !== null && (
          <WhyButton
            label={`${row.ringName}'s willingness to renew`}
            value={decision.value ? 'Willing' : 'Not willing'}
            source={{ trace: decision.trace }}
            buttonLabel={`Why won't ${row.ringName} renew?`}
          />
        )}
      </span>
    );
  }
  const target: NegotiationTarget = talks ?? { kind: 'renewal', employmentId };
  return (
    <Button
      size={size}
      variant={placement === 'row' ? 'secondary' : 'primary'}
      aria-haspopup="dialog"
      onClick={() => {
        setSearchParams((current) =>
          searchWithNegotiation(searchWithEmployment(current, null), target),
        );
      }}
    >
      {talks === null ? 'Renew' : 'Open talks'}
    </Button>
  );
}
