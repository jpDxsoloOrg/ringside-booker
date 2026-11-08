import { useState } from 'react';
import type { AdvanceResult } from '@ringside/engine';
import { Button, IconButton } from '@/components/Button';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { describeAdvance, describeRefusal, failuresToText } from './advanceSummaryText';
import type { AdvanceReport } from './DayAdvanceProvider';
import { useOptionalDayAdvance } from './DayAdvanceProvider';
import styles from './DayControl.module.css';

/**
 * Whether a report earns the banner. A plain Next Day that ran its one day is only announced (the
 * date chip already shows the new day); anything longer, anything that stopped early, any failed
 * step and any refusal gets the banner.
 */
export function reportNeedsBanner(report: AdvanceReport): boolean {
  if (report.kind === 'refused') return true;
  const { result, daysRequested } = report;
  return daysRequested > 1 || result.stoppedBy.kind !== 'completed' || result.failures.length > 0;
}

/** The banner under the top bar after an advance, from the shell's advance controller. */
export function AdvanceSummary() {
  const advance = useOptionalDayAdvance();
  const report = advance?.report ?? null;
  if (advance === null || report === null || !reportNeedsBanner(report)) return null;
  return <AdvanceSummaryBanner report={report} onDismiss={advance.dismissReport} />;
}

export interface AdvanceSummaryBannerProps {
  readonly report: AdvanceReport;
  readonly onDismiss: () => void;
  /**
   * The region's name. The shell shows one banner, so the default is enough there; a page that
   * shows several at once (the gallery) gives each its own, so every region is told apart.
   */
  readonly label?: string;
}

/**
 * "Advanced 30 days to Friday, March 14, 2031", why it stopped, and a link to any background
 * steps that failed. It stays until dismissed or until the next advance replaces it.
 */
export function AdvanceSummaryBanner({
  report,
  onDismiss,
  label = 'Last advance',
}: AdvanceSummaryBannerProps) {
  const [failuresOpen, setFailuresOpen] = useState(false);
  const text =
    report.kind === 'advanced' ? describeAdvance(report.result) : describeRefusal(report.reasons);
  const tone = report.kind === 'refused' ? 'warning' : 'info';

  return (
    <section
      className={styles['summary']}
      data-tone={tone}
      aria-label={label}
      data-testid="advance-summary"
    >
      <div className={styles['summaryBody']}>
        <p className={styles['summaryHeadline']}>{text.headline}</p>
        {text.reason !== null && <p className={styles['summaryReason']}>{text.reason}</p>}
        {report.kind === 'advanced' && text.failures !== null && (
          <>
            <button
              type="button"
              className={styles['failureLink']}
              aria-haspopup="dialog"
              onClick={() => {
                setFailuresOpen(true);
              }}
            >
              <Icon name="warning" decorative />
              {text.failures}
            </button>
            <FailuresSheet
              open={failuresOpen}
              onClose={() => {
                setFailuresOpen(false);
              }}
              failures={report.result.failures}
            />
          </>
        )}
      </div>
      <IconButton icon="close" label="Dismiss" onClick={onDismiss} />
    </section>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

interface FailuresSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly failures: AdvanceResult['failures'];
}

/** Every step that failed during the advance: date, step id and message, ready to copy. */
function FailuresSheet({ open, onClose, failures }: FailuresSheetProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(failuresToText(failures));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={() => {
        setCopyState('idle');
        onClose();
      }}
      title="Background steps that failed"
      footer={
        <div className={styles['sheetFooter']}>
          <p className={styles['copyStatus']} role="status">
            {copyState === 'copied' && 'Copied'}
            {copyState === 'failed' && "Couldn't copy. Select the text instead."}
          </p>
          <Button
            variant="secondary"
            iconStart="clipboard"
            onClick={() => {
              void copy();
            }}
          >
            Copy details
          </Button>
        </div>
      }
    >
      <p className={styles['fieldHint']}>
        The rest of each day ran as normal. These steps were skipped and their changes undone.
      </p>
      <ol className={styles['failureList']}>
        {failures.map((failure, index) => (
          <li
            key={`${failure.date}-${failure.stepId}-${String(index)}`}
            className={styles['failure']}
          >
            <p className={styles['failureMeta']}>
              <span>{formatGameDate(failure.date, 'short')}</span>
              <code className={styles['stepId']}>{failure.stepId}</code>
            </p>
            <p className={styles['failureMessage']}>{failure.message}</p>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
