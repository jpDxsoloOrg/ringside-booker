import { useState } from 'react';
import type { AnswerReleaseResult, OwnContractDetail, Reason } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatGameDate, formatSigned } from '@/components/format';
import { Explained } from '@/components/Trace';
import styles from './ContractsScreen.module.css';
import { useContractMoney } from './useContractMoney';

/** What the panel says while the outcomes are worked out. */
export const ANSWER_LOADING_TEXT = 'Working out both answers…';

export interface ReleaseRequestPanelProps {
  readonly detail: OwnContractDetail;
  /** The morale above which a refused worker settles down (`useContractRules().settlesAbove`). */
  readonly settlesAbove: number;
  /** An answer went through. Grant ends the contract, so the caller closes the sheet. */
  readonly onAnswered: (result: AnswerReleaseResult) => void;
}

function reasonsText(reasons: readonly Reason[]): string {
  return reasons.map((reason) => reason.message).join(' ');
}

/** "Mara Quill wants to leave (asked Mar 3, 2027, answer by Mar 10, 2027)". */
export function requestHeadline(detail: Pick<OwnContractDetail, 'ringName' | 'request'>): string {
  const { request } = detail;
  if (request === null) return '';
  return `${detail.ringName} wants to leave (asked ${formatGameDate(request.raisedOn)}, answer by ${formatGameDate(request.answerBy)})`;
}

/** After a refusal: the live walk-out chance with its Why?, and when they settle down. */
function RefusedRequest({
  detail,
  settlesAbove,
}: {
  readonly detail: OwnContractDetail;
  readonly settlesAbove: number;
}) {
  const { walkout } = detail;
  return (
    <section className={styles['request']} aria-label="Release request">
      <p className={styles['requestHeadline']}>
        {`You refused ${detail.ringName}'s request to leave.`}
      </p>
      {detail.perks.includes('ironClad') ? (
        <p>Iron-clad: they can’t walk out.</p>
      ) : (
        walkout !== null && (
          <p className={styles['requestLine']}>
            <span>Daily walk-out chance</span>
            <Explained
              value={walkout.chance}
              unit="probability"
              label={`${detail.ringName}'s daily walk-out chance`}
              traceRef={walkout.traceRef}
            />
          </p>
        )
      )}
      <p className={styles['muted']}>
        {`Settles down when morale is above ${formatSigned(settlesAbove)}.`}
      </p>
    </section>
  );
}

/**
 * A worker who wants to leave: both answers side by side, each with what it costs and its Why?,
 * and the two buttons. Grant asks first (it ends the contract and pays); Refuse does not (it can
 * be lived with, and the walk-out chance shows straight after).
 */
export function ReleaseRequestPanel({
  detail,
  settlesAbove,
  onAnswered,
}: ReleaseRequestPanelProps) {
  const money = useContractMoney();
  const open = detail.request?.status === 'open';
  const preview = useEngineQuery(
    'contracts.answerPreview',
    { employmentId: detail.employmentId },
    { enabled: open },
  );
  const answerCommand = useEngineCommand('contracts.answerReleaseRequest');
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (detail.request === null) return null;
  if (!open) return <RefusedRequest detail={detail} settlesAbove={settlesAbove} />;

  const answer = preview.status === 'success' ? preview.data : undefined;

  const refuse = async (): Promise<void> => {
    setError(null);
    try {
      const result = await answerCommand.run({
        employmentId: detail.employmentId,
        answer: 'refuse',
      });
      if (result.ok) onAnswered(result.data);
      else setError(reasonsText(result.reasons));
    } catch {
      setError('The game did not answer. Try again.');
    }
  };

  const grant = async (): Promise<void> => {
    const result = await answerCommand.run({ employmentId: detail.employmentId, answer: 'grant' });
    if (!result.ok) throw new Error(reasonsText(result.reasons));
    onAnswered(result.data);
  };

  return (
    <section className={styles['request']} aria-label="Release request">
      <p className={styles['requestHeadline']}>{requestHeadline(detail)}</p>
      {answer === undefined && <p role="status">{ANSWER_LOADING_TEXT}</p>}
      {answer?.kind === 'refused' && <p>{reasonsText(answer.reasons)}</p>}
      {answer?.kind === 'ok' && (
        <div className={styles['outcomes']}>
          <div className={styles['outcome']}>
            <h3 className={styles['outcomeTitle']}>Grant</h3>
            <p>They leave now. You pay</p>
            <Explained
              value={answer.grantSeverance.value}
              unit="money"
              label={`Severance if you let ${detail.ringName} go`}
              trace={answer.grantSeverance.trace}
            />
            <Button
              variant="danger"
              onClick={() => {
                setConfirmGrant(true);
              }}
              disabled={answerCommand.pending}
            >
              Grant
            </Button>
          </div>
          <div className={styles['outcome']}>
            <h3 className={styles['outcomeTitle']}>Refuse</h3>
            <p>{`Morale ${formatSigned(answer.refuseMoraleDelta)}, then`}</p>
            {answer.ironClad ? (
              <p>Iron-clad: they can’t walk out.</p>
            ) : (
              <p className={styles['requestLine']}>
                <Explained
                  value={answer.walkoutChanceAfterRefusal.value}
                  unit="probability"
                  label={`${detail.ringName}'s daily walk-out chance if refused`}
                  trace={answer.walkoutChanceAfterRefusal.trace}
                />
                <span>daily walk-out chance</span>
              </p>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                void refuse();
              }}
              loading={answerCommand.pending && !confirmGrant}
            >
              Refuse
            </Button>
          </div>
        </div>
      )}
      {error !== null && (
        <p role="alert" className={styles['error']}>
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmGrant}
        onClose={() => {
          setConfirmGrant(false);
        }}
        onConfirm={grant}
        title={`Let ${detail.ringName} go?`}
        body={
          answer?.kind === 'ok'
            ? `Their contract ends today and you pay ${money(answer.grantSeverance.value)}. Cash after: ${money(answer.cashBefore - answer.grantSeverance.value)}.`
            : 'Their contract ends today.'
        }
        confirmLabel="Grant"
        tone="danger"
      />
    </section>
  );
}
