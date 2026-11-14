import { cents } from '@ringside/engine';
import type { DealId, Reason } from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useMoneyFormatter } from '@/components/format';
import { Explained } from '@/components/Trace';

export interface CancelDealDialogProps {
  readonly open: boolean;
  readonly dealId: DealId;
  readonly networkName: string;
  readonly onClose: () => void;
  /** The deal is cancelled. The caller closes the sheet and announces it. */
  readonly onCancelled: () => void;
}

function refusalText(reasons: readonly Reason[]): string {
  return reasons.map((reason) => reason.message).join(' ');
}

/** "Cancel your deal with NSN? You pay an exit fee of $41,300." */
export function cancelTitle(networkName: string, fee: string | null): string {
  return fee === null
    ? `Cancel your deal with ${networkName}?`
    : `Cancel your deal with ${networkName}? You pay an exit fee of ${fee}.`;
}

/**
 * Walking away from a deal: a danger confirm whose question names the exit fee from
 * `broadcast.cancelPreview`, with the fee's Why? in the body. A refusal keeps the dialog open
 * and shows the engine's reason.
 */
export function CancelDealDialog({
  open,
  dealId,
  networkName,
  onClose,
  onCancelled,
}: CancelDealDialogProps) {
  const money = useMoneyFormatter();
  const preview = useEngineQuery('broadcast.cancelPreview', { dealId }, { enabled: open });
  const cancel = useEngineCommand('broadcast.cancelDeal');
  const answer = preview.status === 'success' ? preview.data : undefined;
  const fee = answer === undefined ? null : money(cents(answer.exitFee));

  const confirm = async (): Promise<void> => {
    const result = await cancel.run({ dealId });
    if (!result.ok) throw new Error(refusalText(result.reasons));
    onCancelled();
  };

  let body;
  if (preview.status === 'error') {
    body = (
      <p>
        {preview.error?.kind === 'rejected'
          ? refusalText(preview.error.reasons)
          : 'The exit fee could not be worked out.'}
      </p>
    );
  } else if (answer === undefined) {
    body = <p role="status">Working out the exit fee…</p>;
  } else {
    body = (
      <p>
        The deal ends today and no more shows air on {networkName}. Exit fee{' '}
        <Explained value={answer.exitFee} unit="money" label="Exit fee" trace={answer.trace} />
      </p>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={confirm}
      title={cancelTitle(networkName, fee)}
      body={body}
      confirmLabel="Cancel deal"
      cancelLabel="Keep the deal"
      tone="danger"
      confirmDisabled={answer === undefined}
    />
  );
}
