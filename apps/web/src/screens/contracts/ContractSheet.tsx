import { useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AnswerReleaseResult,
  ContractRow,
  EmploymentId,
  ReleaseResult,
} from '@ringside/engine';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { ContractDetailView } from './ContractDetailView';
import { ReleaseDialog } from './ReleaseDialog';
import { useContractRowActions } from './rowActions';
import type { ContractRules } from './useContractRules';
import styles from './ContractsScreen.module.css';

export interface ContractSheetProps {
  /** The contract shown, or null while closed. */
  readonly employmentId: EmploymentId | null;
  /** Its row on the current tab, when it is there: registered actions read it. */
  readonly row: ContractRow | null;
  readonly rules: ContractRules;
  readonly onClose: () => void;
  readonly onReleased: (ringName: string, result: ReleaseResult) => void;
  readonly onAnswered: (ringName: string, result: AnswerReleaseResult) => void;
}

/**
 * One contract in a side sheet (a bottom sheet on a phone): every term, the dates, titles,
 * morale and the unhappy clock, any release request with Grant and Refuse, and the actions pinned
 * in the footer: Got it for a new expiry notice, Release (Call off deal for a signed one) and any
 * action another feature registered.
 */
export function ContractSheet(props: ContractSheetProps) {
  // The sheet keeps showing its last contract while it slides away.
  const { employmentId } = props;
  const [shownId, setShownId] = useState(employmentId);
  if (employmentId !== null && employmentId !== shownId) setShownId(employmentId);
  if (shownId === null) return null;
  return <ShownContractSheet {...props} shownId={shownId} open={employmentId !== null} />;
}

function ShownContractSheet({
  shownId,
  open,
  row,
  rules,
  onClose,
  onReleased,
  onAnswered,
}: ContractSheetProps & { readonly shownId: EmploymentId; readonly open: boolean }) {
  const detailQuery = useEngineQuery('contracts.detail', { employmentId: shownId });
  const acknowledge = useEngineCommand('contracts.acknowledgeExpiries');
  const actions = useContractRowActions();
  const [releasing, setReleasing] = useState(false);
  const detail = detailQuery.status === 'success' ? (detailQuery.data ?? null) : null;

  const own = detail !== null && !detail.termsPrivate ? detail : null;
  const live = own !== null && (own.status === 'active' || own.status === 'signed');
  const openRequest = own?.request?.status === 'open';
  const visibleActions =
    row === null || !live ? [] : actions.filter((action) => action.visible(row));

  const footer =
    own === null || !live ? undefined : (
      <div className={styles['sheetFooter']}>
        {own.notice === 'unseen' && (
          <Button
            variant="primary"
            loading={acknowledge.pending}
            onClick={() => {
              void acknowledge.run({ employmentIds: [own.employmentId] });
            }}
          >
            Got it
          </Button>
        )}
        {visibleActions.map((action) => {
          if (action.render !== undefined && row !== null) {
            const Action = action.render;
            return <Action key={action.id} row={row} placement="sheet" />;
          }
          return (
            <Button
              key={action.id}
              variant="secondary"
              onClick={() => {
                if (row !== null) void action.run?.(row);
              }}
            >
              {action.label}
            </Button>
          );
        })}
        {!openRequest && (
          <Button
            variant="danger"
            onClick={() => {
              setReleasing(true);
            }}
          >
            {own.status === 'signed' ? 'Call off deal' : 'Release'}
          </Button>
        )}
      </div>
    );

  let body;
  if (detailQuery.status === 'error') body = <p>That contract could not be found.</p>;
  else if (detail === null) {
    body = (
      <p role="status">
        {detailQuery.status === 'loading'
          ? 'Loading the contract…'
          : 'That contract could not be found.'}
      </p>
    );
  } else {
    body = (
      <>
        <ContractDetailView
          detail={detail}
          rules={rules}
          onAnswered={(result) => {
            onAnswered(detail.ringName, result);
          }}
        />
        <p className={styles['profileLink']}>
          <Link
            to={routes.game.worker(detail.personId)}
          >{`Open ${detail.ringName}'s profile`}</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={detail?.ringName ?? 'Contract'}
        size="md"
        {...(footer === undefined ? {} : { footer })}
      >
        {body}
      </Sheet>
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
            onReleased(own.ringName, result);
          }}
        />
      )}
    </>
  );
}
