import { useEffect, useState } from 'react';
import { addDays, cents, parseGameDate, parseId } from '@ringside/engine';
import type { AdvanceResult, SimStatus } from '@ringside/engine';
import { AdvanceOverlay } from '@/app/AppShell/day/AdvanceOverlay';
import { AdvanceSummaryBanner } from '@/app/AppShell/day/AdvanceSummary';
import type { AdvanceReport, AutosaveState } from '@/app/AppShell/day/DayAdvanceProvider';
import { AutosaveIndicator } from '@/app/AppShell/status/AutosaveIndicator';
import { StatusChips } from '@/app/AppShell/status/StatusChips';
import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { LiveBugButton } from '@/components/LiveBugButton';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

const TODAY = parseGameDate('2031-03-14');

const STATUS: SimStatus = {
  date: TODAY,
  season: { number: 2, endDate: parseGameDate('2031-06-30') },
  promotion: {
    promotionId: parseId('promotion', 'pro_00000000ab'),
    name: 'Harbor City Wrestling',
    cash: cents(124_350_000),
    popularity: {
      homeRegionId: parseId('region', 'reg_00000000ab'),
      homeRegion: 64,
      prestige: 58,
      traceRef: null,
    },
  },
};

const IN_THE_RED: SimStatus = {
  ...STATUS,
  promotion: STATUS.promotion === null ? null : { ...STATUS.promotion, cash: cents(-1_820_000) },
};

const UNEMPLOYED: SimStatus = { ...STATUS, promotion: null };

function result(overrides: Partial<AdvanceResult>): AdvanceResult {
  return {
    startDate: TODAY,
    endDate: addDays(TODAY, 30),
    daysAdvanced: 30,
    stoppedBy: { kind: 'completed' },
    failures: [],
    eventsPublished: 0,
    timing: { ms: 0 },
    ...overrides,
  };
}

const REPORTS: readonly { readonly title: string; readonly report: AdvanceReport }[] = [
  { title: 'Completed', report: { kind: 'advanced', daysRequested: 30, result: result({}) } },
  {
    title: 'Stopped at a show',
    report: {
      kind: 'advanced',
      daysRequested: 30,
      result: result({
        endDate: addDays(TODAY, 4),
        daysAdvanced: 4,
        stoppedBy: {
          kind: 'gate',
          hits: [
            {
              gateId: 'events.showNeedsBooking',
              reason: "Your show 'Harbor Lights Showdown' on 2031-03-18 has no card yet",
              actionHint: 'booking',
            },
          ],
        },
      }),
    },
  },
  {
    title: 'Stopped by you, with a failed step',
    report: {
      kind: 'advanced',
      daysRequested: 365,
      result: result({
        endDate: addDays(TODAY, 41),
        daysAdvanced: 41,
        stoppedBy: { kind: 'cancelled' },
        failures: [
          {
            date: addDays(TODAY, 1),
            stepId: 'money.payroll',
            message: 'Wage row for a released worker is missing',
          },
        ],
      }),
    },
  },
  {
    title: 'Refused',
    report: {
      kind: 'refused',
      reasons: [{ code: 'busy', message: 'The game is already moving forward.' }],
    },
  },
];

const AUTOSAVE_STATES: readonly AutosaveState[] = [
  { kind: 'saving' },
  { kind: 'saved' },
  {
    kind: 'failed',
    code: 'quota',
    message: 'The browser has no room left for saves. Delete or export old saves.',
  },
];

const OVERLAY_DAYS = 30;

function OverlayDemo() {
  const [running, setRunning] = useState(false);
  const [daysDone, setDaysDone] = useState(0);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      setDaysDone((done) => {
        if (stopping || done + 1 >= OVERLAY_DAYS) {
          setRunning(false);
          return done + 1;
        }
        return done + 1;
      });
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, stopping]);

  return (
    <>
      <Button
        onClick={() => {
          setDaysDone(0);
          setStopping(false);
          setRunning(true);
        }}
      >
        Show the progress overlay
      </Button>
      <AdvanceOverlay
        open={running}
        currentDate={addDays(TODAY, daysDone)}
        daysDone={daysDone}
        daysRequested={OVERLAY_DAYS}
        stopping={stopping}
        onStop={() => {
          setStopping(true);
        }}
      />
    </>
  );
}

function DayControlDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Top bar status (desktop)</h3>
        <div className={broadcast['stage']}>
          <div className={broadcast['row']}>
            <StatusChips status={STATUS} placement="bar" />
            <LiveBugButton iconEnd="next-day">Next day</LiveBugButton>
          </div>
          <div className={broadcast['row']}>
            <StatusChips status={IN_THE_RED} placement="bar" />
            <LiveBugButton iconEnd="chevron-right">Go to show</LiveBugButton>
          </div>
          <div className={broadcast['row']}>
            <StatusChips status={UNEMPLOYED} placement="bar" />
            <LiveBugButton iconEnd="next-day" busy>
              Next day
            </LiveBugButton>
          </div>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Status sheet (phone)</h3>
        <div className={broadcast['stage']}>
          <StatusChips status={STATUS} placement="sheet" />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Autosave beside the date</h3>
        <div className={broadcast['stage']}>
          <div className={broadcast['row']}>
            {AUTOSAVE_STATES.map((state) => (
              <AutosaveIndicator key={state.kind} state={state} />
            ))}
          </div>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Summary banner</h3>
        <Stack gap={3}>
          {REPORTS.map(({ title, report }) => (
            <div key={title}>
              <p className={styles['caption']}>{title}</p>
              <AdvanceSummaryBanner report={report} onDismiss={() => undefined} />
            </div>
          ))}
        </Stack>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Progress overlay</h3>
        <OverlayDemo />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'day-control',
  title: 'Day control and status',
  group: 'Broadcast',
  notes:
    'The end of the in-game top bar: status chips, the day button states, the autosave micro-state, the summary banner after an advance and the skip progress overlay. The live control runs against the engine in the shell.',
  render: () => <DayControlDemo />,
};
