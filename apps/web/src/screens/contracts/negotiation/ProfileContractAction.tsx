import { createContext, lazy, Suspense, useCallback, useContext, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import type { EmploymentId, OfferRow, PersonId, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import type { ProfileTabContext } from '@/screens/workers/profile/profileTabs';
import { negotiationTargetFromSearch, searchWithNegotiation } from '../contractsParams';
import type { NegotiationTarget } from '../contractsParams';
import { useContractRules } from '../useContractRules';
import { offerStatusText } from './negotiationText';
import { renewalWindowText } from './RenewAction';
import { useMarkOffersSeen } from './useMarkOffersSeen';
import styles from '../ContractsScreen.module.css';

/** The situations in which a new offer may be made (the engine's `OPEN_TO_OFFERS`). */
const OPEN_TO_OFFERS = new Set(['freeAgent', 'perAppearanceElsewhere', 'endingSoonElsewhere']);

// The sheet pulls in the offer form, the meter and the counter history: it loads when first opened.
const NegotiationSheet = lazy(async () => {
  const { NegotiationSheet: Sheet } = await import('./NegotiationSheet');
  return { default: Sheet };
});

/** Opens the Negotiation Sheet over the profile. */
const OpenTalksContext = createContext<(target: NegotiationTarget) => void>(() => undefined);

/**
 * The profile's talks (ECO5-09): the Negotiation Sheet opens over the profile from the same
 * `?negotiation=` / `?person=` / `?renew=` parameters the Contracts screen reads, so a reload keeps
 * it open. Every change replaces the entry and keeps the location's state, so the profile's Back
 * link still returns to the Workers list with its filters and sort.
 */
function useProfileTalks(): {
  readonly target: NegotiationTarget | null;
  readonly open: (target: NegotiationTarget | null) => void;
} {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = location.state as unknown;
  const open = useCallback(
    (next: NegotiationTarget | null): void => {
      setSearchParams((current) => searchWithNegotiation(current, next), { replace: true, state });
    },
    [setSearchParams, state],
  );
  return { target: negotiationTargetFromSearch(searchParams), open };
}

function ActionButton({
  label,
  target,
}: {
  readonly label: string;
  readonly target: NegotiationTarget;
}) {
  const openTalks = useContext(OpenTalksContext);
  return (
    <Button
      variant="primary"
      aria-haspopup="dialog"
      onClick={() => {
        openTalks(target);
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
 * Each opens the Negotiation Sheet over the profile (ECO5-09), not on the Contracts screen.
 */
export function ProfileContractAction({ context }: { readonly context: ProfileTabContext }) {
  const { viewerPromotionId, personId, profile } = context;
  const talks = useProfileTalks();
  // The sheet stays mounted once used, so it can slide away and hand focus back when it closes.
  const [sheetUsed, setSheetUsed] = useState(false);
  if (talks.target !== null && !sheetUsed) setSheetUsed(true);
  if (viewerPromotionId === null) return null;
  const own = profile.career.contracts.find(
    (contract) =>
      contract.promotionId === viewerPromotionId &&
      (contract.status === 'active' || contract.status === 'signed'),
  );
  return (
    <OpenTalksContext.Provider value={talks.open}>
      {sheetUsed && (
        <Suspense fallback={null}>
          <NegotiationSheet
            target={talks.target}
            onClose={() => {
              talks.open(null);
            }}
            onOpen={talks.open}
          />
        </Suspense>
      )}
      <AnsweredOffers promotionId={viewerPromotionId} personId={personId} />
      {own === undefined ? (
        <OfferAction promotionId={viewerPromotionId} personId={personId} />
      ) : (
        <RenewProfileAction
          promotionId={viewerPromotionId}
          personId={personId}
          employmentId={own.employmentId}
          endsOn={own.endsOn}
        />
      )}
    </OpenTalksContext.Provider>
  );
}

/**
 * Their answer to your offer that you have not opened yet (ECO5-10): "Your offer: Signed",
 * "Your offer: Walked away from the talks". Showing it here reads it, so it is marked as seen,
 * which clears the day bar's "Offer answered" stop; the line stays until the profile closes.
 */
function AnsweredOffers({
  promotionId,
  personId,
}: {
  readonly promotionId: PromotionId;
  readonly personId: PersonId;
}) {
  const offers = useEngineQuery('contracts.offers', { promotionId, status: 'closed' });
  const unseen = (offers.data ?? []).filter((row) => row.personId === personId && row.answerUnseen);
  // Kept once shown, so marking them seen does not take the line away while the player reads it.
  const [shown, setShown] = useState<readonly OfferRow[]>([]);
  const fresh = unseen.filter(
    (row) => !shown.some((kept) => kept.negotiationId === row.negotiationId),
  );
  if (fresh.length > 0) setShown([...shown, ...fresh]);
  useMarkOffersSeen(unseen.map((row) => row.negotiationId));
  if (shown.length === 0) return null;
  return (
    <ul className={styles['answeredOffers']}>
      {shown.map((row) => (
        <li key={row.negotiationId}>{`Your offer: ${offerStatusText(row)}`}</li>
      ))}
    </ul>
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
  if (talks !== null) return <ActionButton label="Open talks" target={talks} />;
  const daysLeft = detail.data?.daysLeft ?? null;
  if (daysLeft === null || daysLeft > rules.renewalWindowDays) {
    return (
      <DisabledAction label="Renew contract" reason={renewalWindowText(rules.renewalWindowDays)} />
    );
  }
  return (
<ActionButton label="Renew contract" target={{ kind: 'renewal', employmentId }} />
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
  if (talks !== null) return <ActionButton label="Open talks" target={talks} />;
  const eligibility = ask.data?.eligibility;
  if (eligibility === undefined || eligibility.situation === 'unavailable') return null;
  if (!OPEN_TO_OFFERS.has(eligibility.situation)) {
    const reason = eligibility.reasons[0]?.message;
    return reason === undefined ? null : <DisabledAction label="Offer contract" reason={reason} />;
  }
  return (
    <ActionButton label="Offer contract" target={{ kind: 'signing', personId }} />
  );
}
