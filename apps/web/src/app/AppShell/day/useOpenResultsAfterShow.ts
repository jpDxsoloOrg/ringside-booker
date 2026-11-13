import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ShowSummaryView } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSettingsStore } from '@/app/settings/settingsStore';
import type { AdvanceReport } from './DayAdvanceProvider';

/**
 * The advances whose results were already opened (or had none to open). Kept outside any component
 * so the shell remounting the banner never opens the same results twice.
 */
const handledReports = new WeakSet<AdvanceReport>();

/**
 * The show to open after an advance: the first of your shows it ran. `results` comes newest first,
 * so that is the last one.
 */
export function showToOpen(results: readonly ShowSummaryView[]): ShowSummaryView | null {
  return results.at(-1) ?? null;
}

/**
 * EVT3-09's "After a show, open its results": once an advance that ran one of your shows has its
 * results, go to the first show's results page with the reveal. Several shows on one skip open
 * the first; the day summary keeps the links to the rest. Each advance is handled once, and only
 * while the setting is on.
 *
 * Running a show yourself from the show screen (EVT2-09) opens its results whatever this says.
 */
export function useOpenResultsAfterShow(
  report: AdvanceReport,
  results: readonly ShowSummaryView[] | undefined,
): void {
  const enabled = useSettingsStore((state) => state.settings.openResultsAfterShow);
  const navigate = useNavigate();
  useEffect(() => {
    if (results === undefined || handledReports.has(report)) return;
    handledReports.add(report);
    const show = showToOpen(results);
    if (!enabled || show === null) return;
    navigate(routes.game.showResults(show.eventInstanceId, { reveal: true }));
  }, [enabled, navigate, report, results]);
}
