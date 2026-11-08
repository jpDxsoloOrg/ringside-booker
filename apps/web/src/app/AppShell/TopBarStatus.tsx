import { useState } from 'react';
import { Button } from '@/components/Button';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { VisuallyHidden } from '@/components/layout';
import { Sheet } from '@/components/Sheet';
import { AdvanceOverlay } from './day/AdvanceOverlay';
import { DayControl } from './day/DayControl';
import { deriveDayControl } from './day/dayControlState';
import { useDayAdvance } from './day/DayAdvanceProvider';
import styles from './day/DayControl.module.css';
import { SkipDaysSheet } from './day/SkipDaysSheet';
import { AutosaveIndicator } from './status/AutosaveIndicator';
import { StatusChips } from './status/StatusChips';
import { useShellStatus } from './status/useShellStatus';

export interface TopBarStatusProps {
  /** True on phones: the date and the day button only, with the rest in a status sheet. */
  readonly compact: boolean;
}

/**
 * The end of the top bar: the game's status and the control that moves time.
 *
 * Desktop: the date and season, cash, popularity and any registered chips, then the day button
 * and Skip days. Phone: the short date and the day button on one line; tapping the date opens a
 * sheet with every chip and Skip days.
 *
 * It draws nothing until the engine has answered `sim.status`, so a shell with no game loaded
 * (the dev helper's faked world) shows no controls that could not work.
 */
export function TopBarStatus({ compact }: TopBarStatusProps) {
  const { status, gates } = useShellStatus();
  const advance = useDayAdvance();
  const [skipOpen, setSkipOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  if (status === undefined) return null;

  const busy = advance.running || advance.autosave.kind === 'saving';
  const { skipEnabled } = deriveDayControl(gates, { advancing: busy });
  const openSkip = () => {
    setStatusOpen(false);
    setSkipOpen(true);
  };
  const autosave = <AutosaveIndicator state={advance.autosave} />;
  const daysRequested = advance.progress?.daysRequested ?? advance.daysRequested ?? 0;

  return (
    <div className={styles['topBarStatus']} data-testid="top-bar-status">
      {compact ? (
        <>
          <button
            type="button"
            className={styles['dateButton']}
            aria-haspopup="dialog"
            data-testid="status-date"
            onClick={() => {
              setStatusOpen(true);
            }}
          >
            <time dateTime={status.date}>{formatGameDate(status.date, 'short')}</time>
            {advance.autosave.kind === 'failed' && (
              <>
                <Icon name="warning" className={styles['dateWarning']} decorative />
                <VisuallyHidden>, autosave failed</VisuallyHidden>
              </>
            )}
            <VisuallyHidden>, show status</VisuallyHidden>
          </button>
          <DayControl gates={gates} compact onOpenSkip={openSkip} />
          <Sheet
            open={statusOpen}
            onClose={() => {
              setStatusOpen(false);
            }}
            title="Status"
            footer={
              <Button
                variant="secondary"
                iconStart="fast-forward"
                disabled={!skipEnabled}
                onClick={openSkip}
              >
                Skip days
              </Button>
            }
          >
            <StatusChips status={status} placement="sheet" dateTrailing={autosave} />
          </Sheet>
        </>
      ) : (
        <>
          <StatusChips status={status} placement="bar" dateTrailing={autosave} />
          <DayControl gates={gates} onOpenSkip={openSkip} />
        </>
      )}
      <SkipDaysSheet
        open={skipOpen}
        onClose={() => {
          setSkipOpen(false);
        }}
        today={status.date}
        onStart={(request) => {
          void advance.start(request);
        }}
      />
      <AdvanceOverlay
        open={advance.running && daysRequested > 1}
        currentDate={advance.progress?.currentDate ?? status.date}
        daysDone={advance.progress?.daysDone ?? 0}
        daysRequested={daysRequested}
        stopping={advance.stopping}
        onStop={advance.cancel}
      />
    </div>
  );
}
