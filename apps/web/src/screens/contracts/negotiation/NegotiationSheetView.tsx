import type { ReactNode } from 'react';
import type {
  AskingTerms,
  EmploymentRole,
  NegotiationHistoryView,
  NegotiationId,
  PersonRole,
  TraceNode,
} from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { ReactionMeter } from '@/components/ReactionMeter';
import { Sheet } from '@/components/Sheet';
import { WhyButton } from '@/components/Trace';
import { WORKER_ROLE_LABELS } from '@/screens/workers/workerLabels';
import type { ContractMoney } from '../useContractMoney';
import { AskPanel } from './AskPanel';
import { CounterHistory } from './CounterHistory';
import { alsoTalkingText, patienceText } from './negotiationText';
import { OfferForm } from './OfferForm';
import type { NegotiationDraft } from './useNegotiationDraft';
import styles from './Negotiation.module.css';

/** Where the talks stand, which decides the form and the footer's buttons. */
export type NegotiationPhase = 'new' | 'submitted' | 'awaitingReview' | 'countered' | 'closed';

/** The top of the sheet. */
export interface NegotiationHeaderInfo {
  readonly personId: string;
  readonly ringName: string;
  readonly imageRef: string | null;
  readonly roles: readonly PersonRole[];
  readonly age: number | null;
  /** "Free agent", "Per appearance at Crown Pro", "Under contract with you". */
  readonly situation: string;
  /** On a renewal, the deal with you now: "$8,000 a month until Mar 4, 2027". */
  readonly currentDeal: string | null;
}

/** The footer's handlers; each is only shown in the phase it belongs to. */
export interface NegotiationActions {
  readonly onSubmit: () => void;
  readonly onAccept: () => void;
  readonly onRevise: () => void;
  readonly onEnd: () => void;
  readonly onWithdraw: () => void;
}

export interface NegotiationSheetViewProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly header: NegotiationHeaderInfo;
  readonly renewal: boolean;
  readonly phase: NegotiationPhase;
  /** The talks' state in words ("Countered: answer by Jan 14, 2027"), or null for a new offer. */
  readonly statusText: string | null;
  /** The editable offer, for a new offer or an answer to a counter; null otherwise. */
  readonly draft: NegotiationDraft | null;
  /** Their ask, when there is no draft to read it from. */
  readonly ask: AskingTerms | null;
  /** The offer on the table in words, while they think it over. */
  readonly offerOnTable: string | null;
  readonly roles: readonly EmploymentRole[];
  readonly maxLengthMonths: number;
  readonly patience: { readonly left: number; readonly start: number } | null;
  /** Other promotions talking to them, by name only. */
  readonly bidders: readonly string[];
  readonly history: {
    readonly negotiationId: NegotiationId;
    readonly entries: readonly NegotiationHistoryView[];
  } | null;
  /** How closed talks ended, with the (redacted) review as its Why?. */
  readonly outcome: { readonly text: string; readonly trace: TraceNode | null } | null;
  /** A plain line after a command worked: "Offer sent. They'll answer after the next day." */
  readonly notice: string | null;
  /** Refusal reasons tied to no field. */
  readonly errors: readonly string[];
  readonly pending: boolean;
  readonly money: ContractMoney;
  readonly actions: NegotiationActions;
}

function rolesText(roles: readonly PersonRole[]): string {
  return roles.map((role) => WORKER_ROLE_LABELS[role]).join(', ');
}

/**
 * The Negotiation Sheet as it draws (ECO5-06): the worker beside their ask, your offer, the
 * engine's reaction meter with its Why?, patience left, the other bidders by name and the talks so
 * far, with the footer's buttons for the phase. A side sheet on desktop; on a phone it takes the
 * full height with the footer pinned. The container (`NegotiationSheet`) fills it from the engine;
 * the gallery fills it from samples.
 */
export function NegotiationSheetView(props: NegotiationSheetViewProps) {
  const {
    open,
    onClose,
    header,
    renewal,
    phase,
    statusText,
    draft,
    ask,
    offerOnTable,
    roles,
    maxLengthMonths,
    patience,
    bidders,
    history,
    outcome,
    notice,
    errors,
    pending,
    money,
    actions,
  } = props;
  const shownAsk = draft?.ask ?? ask;
  const preview = draft?.preview;
  const refusal = draft?.ask.refusal ?? null;

  let footer: ReactNode = null;
  if (phase === 'new') {
    footer = (
      <Button
        variant="primary"
        loading={pending}
        disabled={draft === null || refusal !== null}
        onClick={actions.onSubmit}
      >
        {renewal ? 'Offer renewal' : 'Submit offer'}
      </Button>
    );
  } else if (phase === 'countered') {
    footer = (
      <>
        <Button variant="primary" loading={pending} onClick={actions.onAccept}>
          Accept counter
        </Button>
        <Button variant="secondary" disabled={pending || draft === null} onClick={actions.onRevise}>
          Send revised offer
        </Button>
        <Button variant="danger" disabled={pending} onClick={actions.onEnd}>
          End talks
        </Button>
      </>
    );
  } else if (phase === 'submitted' || phase === 'awaitingReview') {
    footer = (
      <Button variant="danger" loading={pending} onClick={actions.onWithdraw}>
        Withdraw offer
      </Button>
    );
  }

  const also = alsoTalkingText(bidders);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={renewal ? `Renew ${header.ringName}` : header.ringName}
      side="right"
      size="lg"
      phoneHeight="full"
      className={styles['sheet'] ?? ''}
      {...(footer === null
        ? {}
        : {
            footer: (
              <div className={styles['footer']}>
                {preview !== undefined && (
                  // The meter scrolls away on a phone while you edit the form: its label stays
                  // here, beside the buttons. Screen readers hear the meter's own live label.
                  <p
                    className={styles['footerReaction']}
                    data-band={preview.band}
                    aria-hidden="true"
                  >
                    {preview.label}
                  </p>
                )}
                {footer}
              </div>
            ),
          })}
    >
      <div className={styles['body']}>
        <header className={styles['header']}>
          <ImageSlot
            subject={{
              kind: 'person',
              id: header.personId,
              name: header.ringName,
              ...(header.imageRef === null ? {} : { imageRef: header.imageRef }),
            }}
            size="md"
            decorative
          />
          <div className={styles['identity']}>
            <p className={styles['situation']}>{header.situation}</p>
            <p className={styles['muted']}>
              {[
                rolesText(header.roles),
                header.age === null ? null : `${formatNumber(header.age)} years old`,
              ]
                .filter((part) => part !== null && part !== '')
                .join(' · ')}
            </p>
            {header.currentDeal !== null && (
              <p className={styles['muted']}>{`Now: ${header.currentDeal}`}</p>
            )}
          </div>
        </header>

        <div role="status" className={styles['notice']}>
          {notice !== null && <p>{notice}</p>}
        </div>
        {errors.length > 0 && (
          <ul className={styles['errors']} role="alert">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}

        {statusText !== null && <p className={styles['status']}>{statusText}</p>}
        {outcome !== null && (
          <p className={styles['outcome']}>
            {outcome.text}
            {outcome.trace !== null && (
              <WhyButton
                label="How they decided"
                value={outcome.text}
                source={{ trace: outcome.trace }}
                buttonLabel="Why did the talks end this way?"
              />
            )}
          </p>
        )}

        <div className={styles['columns']}>
          <div className={styles['askColumn']}>
            {draft !== null && preview !== undefined && (
              <div className={styles['meterBlock']}>
                <ReactionMeter
                  ratio={preview.ratio}
                  band={preview.band}
                  label={preview.label}
                  thresholds={preview.thresholds}
                  trace={preview.reactionTrace}
                  pending={draft.previewPending}
                />
                {preview.notes.length > 0 && (
                  <ul className={styles['notes']}>
                    {preview.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {draft !== null && preview === undefined && (
              <p className={styles['muted']} role="status">
                Working out how they would take it…
              </p>
            )}
            {patience !== null && (
              <p className={styles['patience']}>{patienceText(patience.left, patience.start)}</p>
            )}
            {also !== null && <p className={styles['bidders']}>{also}</p>}
            {shownAsk !== null && <AskPanel ask={shownAsk} />}
          </div>
          <div className={styles['offerColumn']}>
            {draft !== null && (
              <OfferForm
                key={draft.version}
                draft={draft}
                money={money}
                roles={roles}
                maxLengthMonths={maxLengthMonths}
                disabled={pending}
              />
            )}
            {draft === null && offerOnTable !== null && (
              <p className={styles['onTable']}>{`Your offer: ${offerOnTable}`}</p>
            )}
          </div>
        </div>

        {history !== null && history.entries.length > 0 && (
          <section className={styles['historySection']}>
            <h3 className={styles['sectionHeading']}>Talks so far</h3>
            <CounterHistory
              negotiationId={history.negotiationId}
              history={history.entries}
              money={money}
            />
          </section>
        )}
      </div>
    </Sheet>
  );
}
