import { useState } from 'react';
import type { LoadIssue } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import type { StorageError } from '@/storage';
import type { LoadFailureStage } from '@/worker/engineHost';
import styles from './SaveSlotsScreen.module.css';
import { formatIssue, LOAD_STAGE_LABELS, MAX_SHOWN_ISSUES } from './slotFormat';

/**
 * A save problem to report: the stage that refused the save and its issues, or (for a storage
 * problem such as a full disk on import) just the message with no stage.
 */
export interface SaveProblem {
  readonly stage: LoadFailureStage | null;
  readonly issues: readonly LoadIssue[];
  /** Issues found beyond the ones listed. */
  readonly truncated: number;
}

/** A storage error as a problem with no load stage. */
export function storageProblem(error: StorageError): SaveProblem {
  return { stage: null, issues: [{ path: '', message: error.message }], truncated: 0 };
}

/** The plain text "Copy details" puts on the clipboard, for a bug report. */
export function problemReport(title: string, problem: SaveProblem): string {
  const lines = [title];
  if (problem.stage !== null) {
    lines.push(`Stage: ${problem.stage} (${LOAD_STAGE_LABELS[problem.stage]})`);
  }
  lines.push(...problem.issues.map(formatIssue));
  if (problem.truncated > 0) lines.push(`and ${String(problem.truncated)} more`);
  lines.push(`Version ${__APP_VERSION__}`);
  return lines.join('\n');
}

type CopyState = 'idle' | 'copied' | 'failed';

export interface LoadErrorSheetProps {
  /** The problem to show; the sheet is closed while it is null. */
  readonly problem: SaveProblem | null;
  readonly onClose: () => void;
  /** What failed, such as "Couldn't load League one". */
  readonly title: string;
  /** Exports the save that failed, so it can go with a bug report. Hidden when left out. */
  readonly onExport?: () => void;
  /** True while that export runs. */
  readonly exporting?: boolean;
}

/**
 * Explains a save that would not load or import: the stage it stopped at, in words, and the
 * first 20 issues with their paths, so a hand-edited save can be fixed and a bug report says
 * exactly what broke. Opens from the side on desktop and from the bottom on phones.
 */
export function LoadErrorSheet({
  problem,
  onClose,
  title,
  onExport,
  exporting = false,
}: LoadErrorSheetProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const close = (): void => {
    setCopyState('idle');
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

  const shownIssues = problem?.issues.slice(0, MAX_SHOWN_ISSUES) ?? [];
  const moreCount =
    problem === null
      ? 0
      : problem.truncated + Math.max(0, problem.issues.length - MAX_SHOWN_ISSUES);

  return (
    <Sheet
      open={problem !== null}
      onClose={close}
      title={title}
      side="right"
      size="md"
      footer={
        problem === null ? undefined : (
          <div className={styles['sheetActions']}>
            <Button
              iconStart="clipboard"
              onClick={() => {
                void copyDetails(problemReport(title, problem));
              }}
            >
              Copy details
            </Button>
            {onExport !== undefined && (
              <Button iconStart="download" loading={exporting} onClick={onExport}>
                Export this save
              </Button>
            )}
          </div>
        )
      }
    >
      {problem !== null && (
        <div className={styles['errorBody']} data-testid="load-error">
          {problem.stage !== null && (
            <p className={styles['errorStage']}>
              Stopped at: <strong>{LOAD_STAGE_LABELS[problem.stage]}</strong>{' '}
              <span className={styles['stageCode']}>({problem.stage})</span>
            </p>
          )}
          <ul className={styles['issueList']}>
            {shownIssues.map((issue, index) => (
              <li key={`${issue.path}-${String(index)}`} className={styles['issue']}>
                {issue.path !== '' && <code className={styles['issuePath']}>{issue.path}</code>}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
          {moreCount > 0 && <p className={styles['moreIssues']}>and {moreCount} more</p>}
          <p className={styles['copyStatus']} role="status">
            {copyState === 'copied' && 'Copied. Paste it into your bug report.'}
            {copyState === 'failed' && 'Could not reach the clipboard.'}
          </p>
        </div>
      )}
    </Sheet>
  );
}
