import type { EmploymentId, Reason, ReleaseResult } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { ConfirmDialog } from '@/components/ConfirmDialog';

import { Explained } from '@/components/Trace';
import styles from './ContractsScreen.module.css';
import { useContractMoney } from './useContractMoney';

/** What the dialog says when the severance moved between the preview and the confirm. */
export const SEVERANCE_CHANGED_TEXT = 'The amount changed; check it again.';

export interface ReleaseDialogProps {
  readonly open: boolean;
  readonly employmentId: EmploymentId;
  readonly ringName: string;
  readonly onClose: () => void;
  /** The release went through. The caller closes the sheet and announces it. */
  readonly onReleased: (result: ReleaseResult) => void;
}

function refusalText(reasons: readonly Reason[]): string {
  if (reasons.some((reason) => reason.code === 'severanceChanged')) return SEVERANCE_CHANGED_TEXT;
  return reasons.map((reason) => reason.message).join(' ');
}

/**
 * Release (or, for a signed deal that has not started, call off): a danger confirm whose body is
 * the engine's preview, so the player sees the severance with its Why?, the cash after and every
 * warning before they agree. If the amount moved in the meantime, the dialog stays open, says so
 * and shows the new amount.
 */
export function ReleaseDialog({
  open,
  employmentId,
  ringName,
  onClose,
  onReleased,
}: ReleaseDialogProps) {
  const money = useContractMoney();
  const preview = useEngineQuery('contracts.releasePreview', { employmentId }, { enabled: open });
  const release = useEngineCommand('contracts.release');
  const answer = preview.status === 'success' ? preview.data : undefined;
  const withdraw = answer?.kind === 'ok' && answer.mode === 'withdraw';

  const confirm = async (): Promise<void> => {
    if (answer?.kind !== 'ok') {
      throw new Error(
        answer === undefined ? 'Still working out the cost.' : refusalText(answer.reasons),
      );
    }
    const result = await release.run({ employmentId, expectedSeverance: answer.severance.value });
    if (!result.ok) throw new Error(refusalText(result.reasons));
    onReleased(result.data);
  };

  let body;
  if (answer === undefined) {
    body = <p role="status">Working out the cost…</p>;
  } else if (answer.kind === 'refused') {
    body = <p>{refusalText(answer.reasons)}</p>;
  } else {
    body = (
      <div className={styles['releaseBody']}>
        <p>
          {withdraw
            ? `${ringName} has signed but not started. Calling the deal off pays them part of what they were promised.`
            : `${ringName} leaves today and is paid severance for the rest of the contract.`}
        </p>
        <dl className={styles['terms']}>
          <div>
            <dt>Severance</dt>
            <dd>
              <Explained
                value={answer.severance.value}
                unit="money"
                label={`${ringName}'s severance`}
                trace={answer.severance.trace}
              />
            </dd>
          </div>
          <div>
            <dt>Cash now</dt>
            <dd className="tabular">{money(answer.cashBefore)}</dd>
          </div>
          <div>
            <dt>Cash after</dt>
            <dd className="tabular" data-tone={answer.cashAfter < 0 ? 'warning' : undefined}>
              {money(answer.cashAfter)}
            </dd>
          </div>
        </dl>
        {answer.warnings.length > 0 && (
          <ul className={styles['warnings']} aria-label="Before you release">
            {answer.warnings.map((warning) => (
              <li key={`${warning.code}-${warning.subject?.id ?? ''}`}>{warning.message}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={confirm}
      title={withdraw ? `Call off the deal with ${ringName}?` : `Release ${ringName}?`}
      body={body}
      confirmLabel={withdraw ? 'Call off deal' : 'Release'}
      tone="danger"
    />
  );
}
