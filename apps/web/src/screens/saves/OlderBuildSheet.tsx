import { useState } from 'react';
import { Link } from 'react-router-dom';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Sheet } from '@/components/Sheet';
import type { LoadSaveFailure, SaveCompat } from '@/worker/engineHost';
import { problemReport } from './LoadErrorSheet';
import type { SaveProblem } from './LoadErrorSheet';
import styles from './OlderBuildSheet.module.css';
import slotStyles from './SaveSlotsScreen.module.css';

export const OLDER_BUILD_TITLE = 'Made with an older build';

/** A save that would not load because an older build made it. */
export interface OlderBuildProblem {
  /** The slot's label, for the report and the delete question. */
  readonly label: string;
  readonly problem: SaveProblem;
  readonly compat: SaveCompat;
}

/** The older-build problem in a load failure, or null when the failure is anything else. */
export function olderBuildProblem(
  label: string,
  failure: LoadSaveFailure,
): OlderBuildProblem | null {
  return failure.compat?.kind === 'olderBuild'
    ? { label, problem: failure, compat: failure.compat }
    : null;
}

/** The plain text "Copy details" puts on the clipboard: the usual report plus both fingerprints. */
export function olderBuildReport(olderBuild: OlderBuildProblem): string {
  return [
    problemReport(`${OLDER_BUILD_TITLE}: ${olderBuild.label}`, olderBuild.problem),
    `Save schema: ${olderBuild.compat.savedFingerprint ?? 'none'}`,
    `This build's schema: ${olderBuild.compat.currentFingerprint}`,
  ].join('\n');
}

type CopyState = 'idle' | 'copied' | 'failed';

export interface OlderBuildSheetProps {
  /** The save to explain; the sheet is closed while it is null. */
  readonly olderBuild: OlderBuildProblem | null;
  readonly onClose: () => void;
  /** Exports the save as a file. */
  readonly onExport: () => void;
  /** True while that export runs. */
  readonly exporting?: boolean;
  /** Deletes the save's slot. Rejecting keeps the confirmation open with the error's message. */
  readonly onDelete: () => Promise<void>;
}

/**
 * Says, in one sentence, that a save comes from an older build and cannot be opened, and offers
 * what the player can do about it: export the file, delete the slot or start a new game. The
 * stage and the issues are left out of the body; "Copy details" still carries them for a bug
 * report.
 */
export function OlderBuildSheet({
  olderBuild,
  onClose,
  onExport,
  exporting = false,
  onDelete,
}: OlderBuildSheetProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const close = (): void => {
    setCopyState('idle');
    setConfirmingDelete(false);
    onClose();
  };

  const copyDetails = async (report: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(report);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <>
      <Sheet
        open={olderBuild !== null}
        onClose={close}
        title={OLDER_BUILD_TITLE}
        side="right"
        size="md"
        footer={
          olderBuild === null ? undefined : (
            <div className={styles['actions']}>
              <Button
                iconStart="clipboard"
                onClick={() => {
                  void copyDetails(olderBuildReport(olderBuild));
                }}
              >
                Copy details
              </Button>
              <Button iconStart="download" loading={exporting} onClick={onExport}>
                Export this save
              </Button>
              <Button
                variant="danger"
                iconStart="trash"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                Delete this save
              </Button>
              <Link to={routes.newGame()} className={styles['newGameLink']}>
                Start a new game
              </Link>
            </div>
          )
        }
      >
        {olderBuild !== null && (
          <div className={slotStyles['errorBody']} data-testid="older-build">
            <p>
              This save was made with an older build of Ringside Booker, and this build can&apos;t
              open it. Start a new game. Export it first if you want to keep the file.
            </p>
            <p className={slotStyles['copyStatus']} role="status">
              {copyState === 'copied' && 'Copied. Paste it into your bug report.'}
              {copyState === 'failed' && 'Could not reach the clipboard.'}
            </p>
          </div>
        )}
      </Sheet>
      <ConfirmDialog
        open={olderBuild !== null && confirmingDelete}
        tone="danger"
        onClose={() => {
          setConfirmingDelete(false);
        }}
        onConfirm={async () => {
          await onDelete();
          close();
        }}
        title={olderBuild === null ? '' : `Delete ${olderBuild.label}?`}
        body="This also deletes its backups. This can't be undone."
        confirmLabel="Delete"
      />
    </>
  );
}
