import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { AdvanceResult, GameDate, Reason } from '@ringside/engine';
import { shouldAutosave } from '@/storage';
import type { StorageErrorCode } from '@/storage';
import type { AdvanceProgress, AdvanceRequest } from '@/worker/engineHost';
import { useAnnounce } from '../../a11y/LiveAnnouncer';
import { useEngineClient } from '../../engine/EngineProvider';
import { useAdvanceDays } from '../../engine/useAdvanceDays';
import { useSessionStore } from '../../session/sessionStore';
import { describeAdvance, describeRefusal } from './advanceSummaryText';

/** How long "Saved" stays beside the date after an autosave. */
export const SAVED_VISIBLE_MS = 4000;

/** The autosave after an advance, as the date chip shows it. */
export type AutosaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | {
      readonly kind: 'failed';
      /** A sentence the UI can show as it is. */
      readonly message: string;
      /** The storage problem (`quota`, `unavailable`, ...), or null for a problem before storage. */
      readonly code: StorageErrorCode | null;
    };

/** How the last advance started here ended, for the summary banner. */
export type AdvanceReport =
  | {
      readonly kind: 'advanced';
      readonly result: AdvanceResult;
      /** The most days the advance was asked to run. */
      readonly daysRequested: number;
    }
  | { readonly kind: 'refused'; readonly reasons: readonly Reason[] };

export interface DayAdvanceValue {
  /** True while any advance runs. */
  readonly running: boolean;
  /** The running advance's latest progress, or null before its first report. */
  readonly progress: AdvanceProgress | null;
  /** The most days the running advance will take, or null when none runs. */
  readonly daysRequested: number | null;
  /** True once Stop was pressed, until the advance ends. */
  readonly stopping: boolean;
  /** Runs an advance, then reports it, announces it and asks the autosave policy. */
  readonly start: (request: AdvanceRequest) => Promise<void>;
  /** Stops the running advance after the day it is on. */
  readonly cancel: () => void;
  /** The last advance's outcome, until dismissed or replaced. */
  readonly report: AdvanceReport | null;
  readonly dismissReport: () => void;
  readonly autosave: AutosaveState;
}

const DayAdvanceContext = createContext<DayAdvanceValue | null>(null);

const IDLE_AUTOSAVE: AutosaveState = { kind: 'idle' };

/** The game date of the last autosave this session wrote, per slot. */
interface AutosaveMark {
  readonly slotId: string;
  readonly gameDate: GameDate;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface DayAdvanceProviderProps {
  readonly children: ReactNode;
}

/**
 * Owns moving time for the shell: the top bar's buttons start advances here, the overlay reads
 * the progress, and the banner under the top bar reads the report.
 *
 * After an advance that moved at least one day (cancelled ones included), it asks the storage
 * policy `shouldAutosave` whether to save, and when it says so, asks the engine host to write
 * the slot's autosave. The host encodes and writes inside the worker, so the save's bytes never
 * come to this thread. A game with no save slot yet has nothing to autosave into.
 *
 * The policy needs the game date of the slot's last autosave. The slot record does not keep it, so
 * this remembers the dates it wrote itself; the first advance after a load counts as "no autosave
 * yet" and writes one, which also gives every session a fresh restore point.
 */
export function DayAdvanceProvider({ children }: DayAdvanceProviderProps) {
  const client = useEngineClient();
  const announce = useAnnounce();
  const { start: startAdvance, cancel: cancelAdvance, progress, running } = useAdvanceDays();
  const [daysRequested, setDaysRequested] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const [report, setReport] = useState<AdvanceReport | null>(null);
  const [autosave, setAutosave] = useState<AutosaveState>(IDLE_AUTOSAVE);
  const lastAutosave = useRef<AutosaveMark | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(savedTimer.current);
    };
  }, []);

  const runAutosave = useCallback(
    async (currentGameDate: GameDate): Promise<void> => {
      const { saveSlotId } = useSessionStore.getState();
      if (saveSlotId === null) return;
      const mark = lastAutosave.current;
      const decision = shouldAutosave({
        lastAutosaveGameDate: mark !== null && mark.slotId === saveSlotId ? mark.gameDate : null,
        currentGameDate,
        // The shows epic reports when the player's own show ran; until then only the day and
        // month rules apply.
        playerShowJustCompleted: false,
        reason: 'dayAdvanced',
      });
      if (!decision.save) return;

      window.clearTimeout(savedTimer.current);
      setAutosave({ kind: 'saving' });
      let next: AutosaveState;
      try {
        const saved = await client.autosave(saveSlotId, { monthlyBackup: decision.monthlyBackup });
        if (saved.ok) {
          lastAutosave.current = { slotId: saveSlotId, gameDate: currentGameDate };
          next = { kind: 'saved' };
        } else {
          next = {
            kind: 'failed',
            message: saved.message,
            code: saved.storageError?.code ?? null,
          };
        }
      } catch (error: unknown) {
        next = { kind: 'failed', message: errorMessage(error), code: null };
      }
      if (!mounted.current) return;
      setAutosave(next);
      if (next.kind === 'saved') {
        savedTimer.current = window.setTimeout(() => {
          setAutosave((current) => (current.kind === 'saved' ? IDLE_AUTOSAVE : current));
        }, SAVED_VISIBLE_MS);
      }
    },
    [client],
  );

  const start = useCallback(
    async (request: AdvanceRequest): Promise<void> => {
      setDaysRequested(request.maxDays);
      setStopping(false);
      let nextReport: AdvanceReport;
      try {
        const outcome = await startAdvance(request);
        nextReport = outcome.ok
          ? { kind: 'advanced', result: outcome, daysRequested: request.maxDays }
          : { kind: 'refused', reasons: outcome.reasons };
      } catch (error: unknown) {
        nextReport = {
          kind: 'refused',
          reasons: [{ code: 'transport', message: errorMessage(error) }],
        };
      }
      if (!mounted.current) return;
      setDaysRequested(null);
      setStopping(false);
      setReport(nextReport);
      const text =
        nextReport.kind === 'advanced'
          ? describeAdvance(nextReport.result)
          : describeRefusal(nextReport.reasons);
      announce(text.announcement, { politeness: 'polite' });
      if (nextReport.kind === 'advanced' && nextReport.result.daysAdvanced > 0) {
        await runAutosave(nextReport.result.endDate);
      }
    },
    [announce, runAutosave, startAdvance],
  );

  const cancel = useCallback(() => {
    setStopping(true);
    cancelAdvance();
  }, [cancelAdvance]);

  const dismissReport = useCallback(() => {
    setReport(null);
  }, []);

  const value = useMemo<DayAdvanceValue>(
    () => ({
      running,
      progress: running ? progress : null,
      daysRequested: running ? daysRequested : null,
      stopping,
      start,
      cancel,
      report,
      dismissReport,
      autosave,
    }),
    [running, progress, daysRequested, stopping, start, cancel, report, dismissReport, autosave],
  );

  return <DayAdvanceContext.Provider value={value}>{children}</DayAdvanceContext.Provider>;
}

/** The shell's advance controller. Throws outside a `DayAdvanceProvider`. */
export function useDayAdvance(): DayAdvanceValue {
  const value = useContext(DayAdvanceContext);
  if (value === null) {
    throw new Error('useDayAdvance() needs a <DayAdvanceProvider> above it.');
  }
  return value;
}

/** The shell's advance controller, or null where there is none (a shell with no engine). */
export function useOptionalDayAdvance(): DayAdvanceValue | null {
  return useContext(DayAdvanceContext);
}
