import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { GameDate } from '@ringside/engine';
import { Button } from '@/components/Button';
import { formatShortGameDateParts } from '@/components/format';
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
import { FanBaseSheet } from './status/FanBaseSheet';
import { StatusChips } from './status/StatusChips';
import { useShellStatus } from './status/useShellStatus';

export interface TopBarStatusProps {
  /** True on phones: the date and the day button only, with the rest in a status sheet. */
  readonly compact: boolean;
  /**
   * Drawn instead when the engine has answered but no world is loaded (the dev helper's faked
   * world), such as the sample status strip. Nothing by default.
   */
  readonly fallback?: ReactNode;
}

/**
 * The phone bar's date. The year is its own piece, which drops out of sight when the bar runs
 * short of room; it stays in the text, so the button's name keeps the whole date.
 */
function ShortDate({ date }: { readonly date: GameDate }) {
  const { monthDay, year } = formatShortGameDateParts(date);
  return (
    <time dateTime={date} className={styles['dateText']}>
      <span>{monthDay}</span>
      <span>{year}</span>
    </time>
  );
}

/**
 * The end of the top bar: the game's status and the control that moves time.
 *
 * Desktop: the date and season, cash, popularity and any registered chips, then the day button
 * and Skip days. Phone: the short date and the day button on one line; tapping the date opens a
 * sheet with every chip and Skip days.
 *
 * It draws nothing until the engine has answered `sim.status`, so a shell with no game loaded
 * (the dev helper's faked world) shows no controls that could not work. If the engine refuses
 * because no world is loaded, it draws `fallback` instead.
 */
export function TopBarStatus({ compact, fallback = null }: TopBarStatusProps) {
  const { status, gates, loading } = useShellStatus();
  const advance = useDayAdvance();
  const [skipOpen, setSkipOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [fanBaseOpen, setFanBaseOpen] = useState(false);
  const dateButtonId = useId();

  if (status === undefined) return loading ? null : fallback;

  const busy = advance.running || advance.autosave.kind === 'saving';
  const { skipEnabled } = deriveDayControl(gates, { advancing: busy });
  const openSkip = () => {
    setStatusOpen(false);
    setSkipOpen(true);
  };
  // From the phone's status sheet the Fan base sheet replaces it rather than stacking on it. It
  // opens first, while the button that asked is still there, so it knows to hand focus back to the
  // date button (`data-return-focus-to`, RETURN_FOCUS_ATTRIBUTE in components/Sheet); then the status sheet closes under it.
  const openFanBaseFromSheet = () => {
    flushSync(() => {
      setFanBaseOpen(true);
    });
    setStatusOpen(false);
  };
  const openFanBaseFromBar = () => {
    setFanBaseOpen(true);
  };
  const autosave = <AutosaveIndicator state={advance.autosave} />;
  const daysRequested = advance.progress?.daysRequested ?? advance.daysRequested ?? 0;

  return (
    <div className={styles['topBarStatus']} data-testid="top-bar-status">
      {compact ? (
        <>
          <button
            type="button"
            id={dateButtonId}
            className={styles['dateButton']}
            aria-haspopup="dialog"
            data-testid="status-date"
            onClick={() => {
              setStatusOpen(true);
            }}
          >
            <ShortDate date={status.date} />
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
            <div data-return-focus-to={dateButtonId}>
              <StatusChips
                status={status}
                placement="sheet"
                dateTrailing={autosave}
                onOpenFanBase={openFanBaseFromSheet}
              />
            </div>
          </Sheet>
        </>
      ) : (
        <>
          <StatusChips
            status={status}
            placement="bar"
            dateTrailing={autosave}
            onOpenFanBase={openFanBaseFromBar}
          />
          <DayControl gates={gates} onOpenSkip={openSkip} />
        </>
      )}
      <FanBaseSheet
        open={fanBaseOpen}
        onClose={() => {
          setFanBaseOpen(false);
        }}
      />
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
