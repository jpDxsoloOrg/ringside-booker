import { useNavigate } from 'react-router-dom';
import type { EmploymentId, PersonId, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import type { ProfileTabContext } from '@/screens/workers/profile/profileTabs';
import { contractsSearch } from '../contractsParams';
import type { NegotiationTarget } from '../contractsParams';
import { useContractRules } from '../useContractRules';
import { renewalWindowText } from './RenewAction';
import styles from '../ContractsScreen.module.css';

/** The situations in which a new offer may be made (the engine's `OPEN_TO_OFFERS`). */
const OPEN_TO_OFFERS = new Set(['freeAgent', 'perAppearanceElsewhere', 'endingSoonElsewhere']);

function ActionButton({
  label,
  tab,
  target,
}: {
  readonly label: string;
  readonly tab: string;
  readonly target: NegotiationTarget;
}) {
  const navigate = useNavigate();
  return (
    <Button
      variant="primary"
      onClick={() => {
        navigate(`${routes.game.contracts()}${contractsSearch(tab, target)}`);
      }}
    >
      {label}
    </Button>
  );
}

function DisabledAction({ label, reason }: { readonly label: string; readonly reason: string }) {
  return (
    <span className={styles['disabledAction']}>
      <Button variant="secondary" disabled>
        {label}
      </Button>
      <span className={styles['reason']}>{reason}</span>
    </span>
  );
}

/** Your open talks with this worker, if any. */
function useOpenTalks(promotionId: PromotionId, personId: PersonId): NegotiationTarget | null {
  const offers = useEngineQuery('contracts.offers', { promotionId, status: 'open' });
  const open = offers.data?.find((row) => row.personId === personId);
  return open === undefined ? null : { kind: 'talks', negotiationId: open.negotiationId };
}

/**
 * The worker profile's contract action (ECO5-06): **Renew contract** for your own worker (disabled
 * with "Talks open 180 days before the contract ends" before the window), **Open talks** while
 * you are talking, **Offer contract** for a free agent or a worker whose deal elsewhere leaves
 * them open to offers, and a disabled **Offer contract** with the reason for a rival's worker you
 * may not approach yet. Hidden for anyone retired or out of the business, and without a promotion.
 */
export function ProfileContractAction({ context }: { readonly context: ProfileTabContext }) {
  const { viewerPromotionId, personId, profile } = context;
  if (viewerPromotionId === null) return null;
  const own = profile.career.contracts.find(
    (contract) =>
      contract.promotionId === viewerPromotionId &&
      (contract.status === 'active' || contract.status === 'signed'),
  );
  return own === undefined ? (
    <OfferAction promotionId={viewerPromotionId} personId={personId} />
  ) : (
    <RenewProfileAction
      promotionId={viewerPromotionId}
      personId={personId}
      employmentId={own.employmentId}
      endsOn={own.endsOn}
    />
  );
}

function RenewProfileAction({
  promotionId,
  personId,
  employmentId,
  endsOn,
}: {
  readonly promotionId: PromotionId;
  readonly personId: PersonId;
  readonly employmentId: EmploymentId;
  readonly endsOn: string | null;
}) {
  const rules = useContractRules();
  const talks = useOpenTalks(promotionId, personId);
  const detail = useEngineQuery('contracts.detail', { employmentId });
  if (endsOn === null) return null;
  if (talks !== null) return <ActionButton label="Open talks" tab="offers" target={talks} />;
  const daysLeft = detail.data?.daysLeft ?? null;
  if (daysLeft === null || daysLeft > rules.renewalWindowDays) {
    return (
      <DisabledAction label="Renew contract" reason={renewalWindowText(rules.renewalWindowDays)} />
    );
  }
  return (
    <ActionButton
      label="Renew contract"
      tab="expiring"
      target={{ kind: 'renewal', employmentId }}
    />
  );
}

function OfferAction({
  promotionId,
  personId,
}: {
  readonly promotionId: PromotionId;
  readonly personId: PersonId;
}) {
  const talks = useOpenTalks(promotionId, personId);
  const ask = useEngineQuery('contracts.askingTerms', { promotionId, personId });
  if (talks !== null) return <ActionButton label="Open talks" tab="offers" target={talks} />;
  const eligibility = ask.data?.eligibility;
  if (eligibility === undefined || eligibility.situation === 'unavailable') return null;
  if (!OPEN_TO_OFFERS.has(eligibility.situation)) {
    const reason = eligibility.reasons[0]?.message;
    return reason === undefined ? null : <DisabledAction label="Offer contract" reason={reason} />;
  }
  return (
    <ActionButton label="Offer contract" tab="free-agents" target={{ kind: 'signing', personId }} />
  );
}
