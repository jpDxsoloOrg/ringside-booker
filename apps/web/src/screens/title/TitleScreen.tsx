import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { isNoWorldRedirect } from '@/app/RequireWorld';
import { routes } from '@/app/routes';
import { settingsLinkState } from '@/app/settings/settingsNavigation';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { BUNDLED_ENGINE_VERSION } from '@/engineVersion';
import { LoadErrorSheet } from '@/screens/saves/LoadErrorSheet';
import type { SaveProblem } from '@/screens/saves/LoadErrorSheet';
import { importProblem } from '@/screens/saves/SaveSlotsScreen';
import type { HighlightSlotState } from '@/screens/saves/SaveSlotsScreen';
import { slotSummaryLine } from '@/screens/saves/slotFormat';
import { useImportSave } from '@/screens/saves/useImportSave';
import { useLoadGame } from '@/screens/saves/useLoadGame';
import { useSaveSlots } from '@/screens/saves/useSaveSlots';
import type { SlotRecord } from '@/storage';
import styles from './TitleScreen.module.css';

interface ContinueError {
  readonly slot: SlotRecord;
  readonly problem: SaveProblem;
}

/**
 * The front door at `/`: the game's name, Continue for the most recently played save, then New
 * game, Load game, Import save and Settings, and the app and engine versions underneath. A single
 * column of full-width buttons on every screen size.
 */
export function TitleScreen() {
  useDocumentTitle(null);
  const location = useLocation();
  const navigate = useNavigate();
  const cameFromGameRoute = isNoWorldRedirect(location.state);
  const saveSlots = useSaveSlots();
  const { loadSlot, pending } = useLoadGame();
  const [continueError, setContinueError] = useState<ContinueError | null>(null);
  const [importError, setImportError] = useState<SaveProblem | null>(null);
  const [exporting, setExporting] = useState(false);

  // listSlots returns the newest updatedAt first, so the first slot is the one to continue.
  const latestSlot = saveSlots.slots[0];

  const importSave = useImportSave(saveSlots.importFile, (result) => {
    if (result.ok) {
      const state: HighlightSlotState = {
        highlightSlotId: result.slot.slotId,
        importedLabel: result.slot.label,
      };
      navigate(routes.load(), { state });
    } else {
      setImportError(importProblem(result));
    }
  });

  const continueGame = async (slot: SlotRecord): Promise<void> => {
    const failure = await loadSlot(slot.slotId, 'latest');
    if (failure !== null) setContinueError({ slot, problem: failure });
  };

  const exportFailedSave = async (slot: SlotRecord): Promise<void> => {
    setExporting(true);
    try {
      await saveSlots.exportSlot(slot.slotId);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className={styles['screen']} aria-busy={pending !== null ? true : undefined}>
      <div className={styles['brand']}>
        <span className={styles['slash']} aria-hidden="true" />
        <RouteHeading className={styles['wordmark']}>Ringside Booker</RouteHeading>
        <p className={styles['tagline']}>Book the shows. Run the promotion.</p>
      </div>

      {cameFromGameRoute && (
        <p className={styles['notice']} role="status">
          Load or start a game first.
        </p>
      )}

      <nav aria-label="Main menu" className={styles['menu']}>
        {latestSlot !== undefined && (
          <Button
            variant="primary"
            size="lg"
            className={styles['continue']}
            loading={pending !== null}
            onClick={() => {
              void continueGame(latestSlot);
            }}
          >
            <span className={styles['continueText']}>
              <span>Continue</span>
              <span className={styles['continueDetail']}>{slotSummaryLine(latestSlot)}</span>
            </span>
          </Button>
        )}
        <Link to={routes.newGame()} className={styles['menuLink']}>
          <Icon name="add" decorative />
          New game
        </Link>
        <Link to={routes.load()} className={styles['menuLink']}>
          <Icon name="file-text" decorative />
          Load game
        </Link>
        <button
          type="button"
          className={styles['menuLink']}
          aria-busy={importSave.importing ? true : undefined}
          disabled={importSave.importing}
          onClick={importSave.openPicker}
        >
          <Icon name="upload" decorative />
          {importSave.importing ? 'Importing…' : 'Import save'}
        </button>
        {importSave.fileInput}
        <Link
          to={routes.settings()}
          state={settingsLinkState(routes.title())}
          className={styles['menuLink']}
        >
          <Icon name="settings" decorative />
          Settings
        </Link>
      </nav>

      {saveSlots.state.status === 'error' && (
        <p className={styles['storageError']} role="alert">
          {saveSlots.state.error.message}
        </p>
      )}

      <footer className={styles['footer']}>
        <span>App v{__APP_VERSION__}</span>
        <span aria-hidden="true">·</span>
        <span>Engine v{BUNDLED_ENGINE_VERSION}</span>
      </footer>

      <LoadErrorSheet
        problem={continueError?.problem ?? null}
        title={continueError === null ? '' : `Couldn't load ${continueError.slot.label}`}
        onClose={() => {
          setContinueError(null);
        }}
        exporting={exporting}
        {...(continueError === null
          ? {}
          : {
              onExport: () => {
                void exportFailedSave(continueError.slot);
              },
            })}
      />
      <LoadErrorSheet
        problem={importError}
        title="Couldn't import that file"
        onClose={() => {
          setImportError(null);
        }}
      />
    </div>
  );
}
