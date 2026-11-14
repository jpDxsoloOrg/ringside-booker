import { useState } from 'react';
import { ALREADY_NEGOTIATING_CODE, isId, ratingRoleOfPersonRole } from '@ringside/engine';
import type {
  AskingTermsView,
  CommandResult,
  EmploymentId,
  EmploymentRole,
  NegotiationView,
  Offer,
  PersonId,
  PromotionId,
  Reason,
  WorkerProfileHeader,
} from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useSessionStore } from '@/app/session/sessionStore';
import { formatGameDate } from '@/components/format';
import { Sheet } from '@/components/Sheet';
import type { NegotiationTarget } from '../contractsParams';
import { useContractMoney } from '../useContractMoney';
import type { ContractMoney } from '../useContractMoney';
import { useContractRules } from '../useContractRules';
import { wageText } from '../contractColumns';
import {
  offerSentText,
  offerStatusText,
  offerSummaryText,
  situationWords,
} from './negotiationText';
import { NegotiationSheetView } from './NegotiationSheetView';
import type { NegotiationHeaderInfo, NegotiationPhase } from './NegotiationSheetView';
import { useNegotiationDraft } from './useNegotiationDraft';
import styles from './Negotiation.module.css';

export interface NegotiationSheetProps {
  /** What the sheet is open on, or null while closed (it keeps its last target as it slides away). */
  readonly target: NegotiationTarget | null;
  readonly onClose: () => void;
  /** Moves the sheet to other talks (after an offer is made, or to talks already open). */
  readonly onOpen: (target: NegotiationTarget) => void;
}

/** What a finished command left to say, kept while the sheet moves to the new talks. */
interface Feedback {
  readonly notice: string | null;
  readonly errors: readonly string[];
}

const NO_FEEDBACK: Feedback = { notice: null, errors: [] };

/**
 * The Negotiation Sheet (ECO5-06), opened from the URL by the Contracts screen: a new offer to a
 * worker (`?person=`), a renewal of your contract (`?renew=`), or your talks (`?negotiation=`).
 * It reads the ask, the preview and the talks from the engine and sends the offer commands; the
 * engine decides everything, the sheet only shows it.
 */
export function NegotiationSheet({ target, onClose, onOpen }: NegotiationSheetProps) {
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown && !sameTarget(target, shown)) setShown(target);
  const [feedback, setFeedback] = useState<Feedback>(NO_FEEDBACK);
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  if (shown === null) return null;
  const open = target !== null;
  const close = (): void => {
    setFeedback(NO_FEEDBACK);
    onClose();
  };
  if (promotionId === null) {
    return (
      <Sheet open={open} onClose={close} title="Contract talks" size="lg" phoneHeight="full">
        <p>Run a promotion to talk contracts.</p>
      </Sheet>
    );
  }
  const common = {
    open,
    onClose: close,
    onOpen,
    promotionId,
    feedback,
    setFeedback,
  };
  switch (shown.kind) {
    case 'talks':
      return (
        <TalksSheet key={shown.negotiationId} {...common} negotiationId={shown.negotiationId} />
      );
    case 'renewal':
      return (
        <RenewalSheet key={shown.employmentId} {...common} employmentId={shown.employmentId} />
      );
    case 'signing':
      return <SigningSheet key={shown.personId} {...common} personId={shown.personId} />;
  }
}

function sameTarget(left: NegotiationTarget, right: NegotiationTarget | null): boolean {
  return right !== null && JSON.stringify(left) === JSON.stringify(right);
}

interface SheetCommon {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onOpen: (target: NegotiationTarget) => void;
  readonly promotionId: PromotionId;
  readonly feedback: Feedback;
  readonly setFeedback: (feedback: Feedback) => void;
}

/** The roles a person could be hired in, from their profile. */
function employmentRoles(header: WorkerProfileHeader | undefined): EmploymentRole[] {
  if (header === undefined) return [];
  return [...new Set(header.roles.map((role) => ratingRoleOfPersonRole(role)))];
}

function headerInfo(
  personId: PersonId,
  profile: WorkerProfileHeader | undefined,
  fallbackName: string,
  situation: string,
  currentDeal: string | null,
): NegotiationHeaderInfo {
  return {
    personId,
    ringName: profile?.ringName ?? fallbackName,
    imageRef: profile?.imageRef ?? null,
    roles: profile?.roles ?? [],
    age: profile?.age ?? null,
    situation,
    currentDeal,
  };
}

/** A sheet with only a line in it, while the talks load or when they cannot be found. */
function LoadingSheet({
  open,
  onClose,
  title,
  text,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly text: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} size="lg" phoneHeight="full">
      <p role="status" className={styles['muted']}>
        {text}
      </p>
    </Sheet>
  );
}

/** A refused or failed query in words. */
function queryErrorText(error: EngineQueryError | null): string {
  if (error === null) return '';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** Reasons a refused command gave, with the ones tied to a field shown under that field. */
function refusalErrors(
  result: CommandResult<unknown>,
  showRefusal: (reasons: readonly Reason[]) => Reason[],
): string[] {
  if (result.ok) return [];
  return showRefusal(result.reasons).map((reason) => reason.message);
}

/** The talks already open that a refusal points at ("You are already talking to them"). */
function talksFromRefusal(result: CommandResult<unknown>): NegotiationTarget | null {
  if (result.ok) return null;
  const subject = result.reasons.find(
    (reason) => reason.code === ALREADY_NEGOTIATING_CODE,
  )?.subject;
  return subject?.kind === 'negotiation' && isId('negotiation', subject.id)
    ? { kind: 'talks', negotiationId: subject.id }
    : null;
}

/** A new offer to a worker you are not talking to yet. */
function SigningSheet({ personId, ...common }: SheetCommon & { readonly personId: PersonId }) {
  const askQuery = useEngineQuery('contracts.askingTerms', {
    promotionId: common.promotionId,
    personId,
  });
  const profile = useEngineQuery('workers.profile', { personId });
  const ringName = profile.data?.header.ringName ?? 'Worker';
  if (askQuery.status !== 'success' || askQuery.data === undefined) {
    return (
      <LoadingSheet
        open={common.open}
        onClose={common.onClose}
        title={ringName}
        text={
          askQuery.status === 'error'
            ? `You can't make them an offer. ${queryErrorText(askQuery.error)}`
            : 'Loading their ask…'
        }
      />
    );
  }
  return (
    <NewOfferSheet
      {...common}
      personId={personId}
      initialAsk={askQuery.data}
      header={profile.data?.header}
      renewalOf={undefined}
      currentDeal={null}
    />
  );
}

/** A renewal of one of your contracts, before talks open. */
function RenewalSheet({
  employmentId,
  ...common
}: SheetCommon & { readonly employmentId: EmploymentId }) {
  const money = useContractMoney();
  const detail = useEngineQuery('contracts.detail', { employmentId });
  const own =
    detail.data !== undefined && detail.data !== null && !detail.data.termsPrivate
      ? detail.data
      : null;
  const personId = own?.personId ?? null;
  if (own === null || personId === null) {
    return (
      <LoadingSheet
        open={common.open}
        onClose={common.onClose}
        title="Renewal"
        text={
          detail.status === 'loading'
            ? 'Loading the contract…'
            : 'That contract could not be found.'
        }
      />
    );
  }
  const currentDeal = `${wageText(own, money)}${own.endsOn === null ? '' : ` until ${formatGameDate(own.endsOn)}`}`;
  return (
    <RenewalAsk
      {...common}
      personId={personId}
      employmentId={employmentId}
      ringName={own.ringName}
      currentDeal={currentDeal}
    />
  );
}

function RenewalAsk({
  personId,
  employmentId,
  ringName,
  currentDeal,
  ...common
}: SheetCommon & {
  readonly personId: PersonId;
  readonly employmentId: EmploymentId;
  readonly ringName: string;
  readonly currentDeal: string;
}) {
  const askQuery = useEngineQuery('contracts.askingTerms', {
    promotionId: common.promotionId,
    personId,
    renewalOf: employmentId,
  });
  const profile = useEngineQuery('workers.profile', { personId });
  if (askQuery.status !== 'success' || askQuery.data === undefined) {
    return (
      <LoadingSheet
        open={common.open}
        onClose={common.onClose}
        title={`Renew ${ringName}`}
        text={
          askQuery.status === 'error'
            ? 'They cannot be offered a renewal now.'
            : 'Loading their ask…'
        }
      />
    );
  }
  return (
    <NewOfferSheet
      {...common}
      personId={personId}
      initialAsk={askQuery.data}
      header={profile.data?.header}
      renewalOf={employmentId}
      currentDeal={currentDeal}
    />
  );
}

/** The form for a first offer (a signing or a renewal), and Submit. */
function NewOfferSheet({
  open,
  onClose,
  onOpen,
  promotionId,
  feedback,
  setFeedback,
  personId,
  initialAsk,
  header,
  renewalOf,
  currentDeal,
}: SheetCommon & {
  readonly personId: PersonId;
  readonly initialAsk: AskingTermsView;
  readonly header: WorkerProfileHeader | undefined;
  readonly renewalOf: EmploymentId | undefined;
  readonly currentDeal: string | null;
}) {
  const money = useContractMoney();
  const rules = useContractRules();
  const makeOffer = useEngineCommand('contracts.makeOffer');
  const offerRenewal = useEngineCommand('contracts.offerRenewal');
  const draft = useNegotiationDraft({
    promotionId,
    personId,
    initialAsk,
    renewalOf,
    seed: null,
    maxLengthMonths: rules.maxLengthMonths,
  });
  const bidders = useEngineQuery(
    'contracts.freeAgents',
    { promotionId, search: header?.ringName ?? '' },
    { enabled: renewalOf === undefined && header !== undefined },
  );
  const bidderNames =
    bidders.data?.find((row) => row.personId === personId)?.competingBidders ?? [];
  const situation = situationWords(
    initialAsk.eligibility.situation,
    header?.employer?.name ?? null,
    initialAsk.eligibility.situation === 'endingSoonElsewhere'
      ? initialAsk.eligibility.earliestStart
      : null,
  );

  const submit = async (): Promise<void> => {
    setFeedback(NO_FEEDBACK);
    const result =
      renewalOf === undefined
        ? await makeOffer.run({ promotionId, personId, offer: draft.offer })
        : await offerRenewal.run({ employmentId: renewalOf, offer: draft.offer });
    if (result.ok) {
      setFeedback({ notice: offerSentText(null), errors: [] });
      onOpen({ kind: 'talks', negotiationId: result.data.negotiationId });
      return;
    }
    const talks = talksFromRefusal(result);
    if (talks !== null) {
      onOpen(talks);
      return;
    }
    setFeedback({ notice: null, errors: refusalErrors(result, draft.showRefusal) });
  };

  return (
    <NegotiationSheetView
      open={open}
      onClose={onClose}
      header={headerInfo(personId, header, 'Worker', situation, currentDeal)}
      renewal={renewalOf !== undefined}
      phase="new"
      statusText={null}
      draft={draft}
      ask={null}
      offerOnTable={null}
      roles={employmentRoles(header)}
      maxLengthMonths={rules.maxLengthMonths}
      patience={{ left: initialAsk.startPatience.value, start: initialAsk.startPatience.value }}
      bidders={bidderNames}
      history={null}
      outcome={null}
      notice={feedback.notice}
      errors={[
        ...feedback.errors,
        ...(initialAsk.refusal === null ? [] : [initialAsk.refusal.message]),
      ]}
      pending={makeOffer.pending || offerRenewal.pending}
      money={money}
      actions={{
        onSubmit: () => {
          void submit();
        },
        onAccept: () => undefined,
        onRevise: () => undefined,
        onEnd: () => undefined,
        onWithdraw: () => undefined,
      }}
    />
  );
}

/** Your talks: answer a counter, withdraw an offer, or read how they ended. */
function TalksSheet({
  negotiationId,
  ...common
}: SheetCommon & { readonly negotiationId: NegotiationView['negotiationId'] }) {
  const view = useEngineQuery('contracts.negotiation', { negotiationId });
  if (view.status !== 'success' || view.data === undefined) {
    return (
      <LoadingSheet
        open={common.open}
        onClose={common.onClose}
        title="Contract talks"
        text={view.status === 'error' ? 'Those talks could not be found.' : 'Loading the talks…'}
      />
    );
  }
  return <LoadedTalks {...common} view={view.data} />;
}

function phaseOf(view: NegotiationView): NegotiationPhase {
  switch (view.status) {
    case 'submitted':
    case 'awaitingReview':
    case 'countered':
      return view.status;
    case 'signed':
    case 'walkedAway':
    case 'declined':
    case 'lapsed':
    case 'withdrawn':
      return 'closed';
  }
}

function LoadedTalks({ view, ...common }: SheetCommon & { readonly view: NegotiationView }) {
  const phase = phaseOf(view);
  const profile = useEngineQuery('workers.profile', { personId: view.personId });
  const header = headerInfo(
    view.personId,
    profile.data?.header,
    view.ringName,
    view.kind === 'renewal' ? 'Renewing with you' : 'New contract',
    null,
  );
  if (phase === 'countered') {
    return (
      <CounteredTalks {...common} view={view} header={header} profile={profile.data?.header} />
    );
  }
  return <ReadOnlyTalks {...common} view={view} header={header} phase={phase} />;
}

function historyOf(view: NegotiationView) {
  return { negotiationId: view.negotiationId, entries: view.history };
}

function ReadOnlyTalks({
  view,
  header,
  phase,
  open,
  onClose,
  feedback,
  setFeedback,
}: SheetCommon & {
  readonly view: NegotiationView;
  readonly header: NegotiationHeaderInfo;
  readonly phase: NegotiationPhase;
}) {
  const money = useContractMoney();
  const rules = useContractRules();
  const withdraw = useEngineCommand('contracts.withdrawOffer');
  const closed = phase === 'closed';
  return (
    <NegotiationSheetView
      open={open}
      onClose={onClose}
      header={header}
      renewal={view.kind === 'renewal'}
      phase={phase}
      statusText={closed ? null : offerStatusText(view)}
      draft={null}
      ask={view.ask}
      offerOnTable={offerSummaryText(view.offer, money)}
      roles={[]}
      maxLengthMonths={rules.maxLengthMonths}
      patience={closed ? null : { left: view.patienceLeft, start: view.startPatience }}
      bidders={closed ? [] : view.competingBidders}
      history={historyOf(view)}
      outcome={closed ? { text: offerStatusText(view), trace: view.reviewTrace } : null}
      notice={
        feedback.notice ??
        (view.status === 'awaitingReview' && view.reviewOn !== null
          ? offerSentText(view.reviewOn)
          : null)
      }
      errors={feedback.errors}
      pending={withdraw.pending}
      money={money}
      actions={{
        onSubmit: () => undefined,
        onAccept: () => undefined,
        onRevise: () => undefined,
        onEnd: () => undefined,
        onWithdraw: () => {
          void (async () => {
            const result = await withdraw.run({ negotiationId: view.negotiationId });
            setFeedback(
              result.ok
                ? { notice: 'You withdrew the offer.', errors: [] }
                : { notice: null, errors: result.reasons.map((reason) => reason.message) },
            );
          })();
        },
      }}
    />
  );
}

function CounteredTalks({
  view,
  header,
  profile,
  open,
  onClose,
  promotionId,
  feedback,
  setFeedback,
}: SheetCommon & {
  readonly view: NegotiationView;
  readonly header: NegotiationHeaderInfo;
  readonly profile: WorkerProfileHeader | undefined;
}) {
  const money = useContractMoney();
  const rules = useContractRules();
  const respond = useEngineCommand('contracts.respondToCounter');
  const renewalOf = view.ask.renewalOf ?? undefined;
  const askQuery = useEngineQuery('contracts.askingTerms', {
    promotionId,
    personId: view.personId,
    kind: view.offer.terms.kind,
    exclusive: view.offer.terms.exclusive,
    ...(renewalOf === undefined ? {} : { renewalOf }),
  });
  if (askQuery.status !== 'success' || askQuery.data === undefined) {
    return (
      <LoadingSheet
        open={open}
        onClose={onClose}
        title={header.ringName}
        text="Loading their ask…"
      />
    );
  }
  return (
    <CounterForm
      view={view}
      header={header}
      roles={employmentRoles(profile)}
      initialAsk={askQuery.data}
      open={open}
      onClose={onClose}
      promotionId={promotionId}
      renewalOf={renewalOf}
      maxLengthMonths={rules.maxLengthMonths}
      money={money}
      respond={respond}
      feedback={feedback}
      setFeedback={setFeedback}
    />
  );
}

function CounterForm({
  view,
  header,
  roles,
  initialAsk,
  open,
  onClose,
  promotionId,
  renewalOf,
  maxLengthMonths,
  money,
  respond,
  feedback,
  setFeedback,
}: {
  readonly view: NegotiationView;
  readonly header: NegotiationHeaderInfo;
  readonly roles: readonly EmploymentRole[];
  readonly initialAsk: AskingTermsView;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly promotionId: PromotionId;
  readonly renewalOf: EmploymentId | undefined;
  readonly maxLengthMonths: number;
  readonly money: ContractMoney;
  readonly respond: ReturnType<typeof useEngineCommand<'contracts.respondToCounter'>>;
  readonly feedback: Feedback;
  readonly setFeedback: (feedback: Feedback) => void;
}) {
  const seed: Offer | null = view.lastCounter ?? view.offer;
  const draft = useNegotiationDraft({
    promotionId,
    personId: view.personId,
    initialAsk,
    negotiationId: view.negotiationId,
    renewalOf,
    seed,
    maxLengthMonths,
  });
  const answer = async (response: 'accept' | 'revise' | 'end'): Promise<void> => {
    setFeedback(NO_FEEDBACK);
    const result = await respond.run(
      response === 'revise'
        ? { negotiationId: view.negotiationId, response, offer: draft.offer }
        : { negotiationId: view.negotiationId, response },
    );
    if (!result.ok) {
      setFeedback({ notice: null, errors: refusalErrors(result, draft.showRefusal) });
      return;
    }
    // An accepted counter shows "They'll decide on <date>" from the talks themselves.
    if (result.data.status === 'awaitingReview') {
      setFeedback(NO_FEEDBACK);
      return;
    }
    setFeedback({
      notice: response === 'end' ? 'You ended the talks.' : offerSentText(null),
      errors: [],
    });
  };
  return (
    <NegotiationSheetView
      open={open}
      onClose={onClose}
      header={header}
      renewal={view.kind === 'renewal'}
      phase="countered"
      statusText={offerStatusText(view)}
      draft={draft}
      ask={null}
      offerOnTable={null}
      roles={roles}
      maxLengthMonths={maxLengthMonths}
      patience={{ left: view.patienceLeft, start: view.startPatience }}
      bidders={view.competingBidders}
      history={historyOf(view)}
      outcome={null}
      notice={feedback.notice}
      errors={feedback.errors}
      pending={respond.pending}
      money={money}
      actions={{
        onSubmit: () => undefined,
        onAccept: () => {
          void answer('accept');
        },
        onRevise: () => {
          void answer('revise');
        },
        onEnd: () => {
          void answer('end');
        },
        onWithdraw: () => undefined,
      }}
    />
  );
}
