import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { isStorageError } from '@/storage';
import type { BackupMeta, ImportResult, SlotRecord } from '@/storage';
import type { LoadFailureStage } from '@/worker/engineHost';
import { BackupsSheet } from './BackupsSheet';
import { LoadErrorSheet, storageProblem } from './LoadErrorSheet';
import type { SaveProblem } from './LoadErrorSheet';
import { SaveSlotCard } from './SaveSlotCard';
import styles from './SaveSlotsScreen.module.css';
import { UNREADABLE_STAGES } from './slotFormat';
import { useImportSave } from './useImportSave';
import { useLoadGame } from './useLoadGame';
import { useSaveSlots } from './useSaveSlots';

/** Navigation state that asks the slot list to point out a slot, such as one just imported. */
export interface HighlightSlotState {
  readonly highlightSlotId: string;
  /** Announced as "Imported {label}" when the list opens. */
  readonly importedLabel?: string;
}

/** The highlight request in a location's state, if there is one. */
export function highlightFrom(state: unknown): HighlightSlotState | null {
  if (typeof state !== 'object' || state === null || !('highlightSlotId' in state)) return null;
  const { highlightSlotId } = state;
  if (typeof highlightSlotId !== 'string') return null;
  const importedLabel = 'importedLabel' in state ? state.importedLabel : undefined;
  return typeof importedLabel === 'string'
    ? { highlightSlotId, importedLabel }
    : { highlightSlotId };
}

/** The problem an import failure shows: the inspect stage and issues, or the storage message. */
export function importProblem(result: Extract<ImportResult, { ok: false }>): SaveProblem {
  if (isStorageError(result.error)) return storageProblem(result.error);
  return {
    stage: result.error.stage,
    issues: result.error.issues,
    truncated: result.error.truncated,
  };
}

interface SlotLoadError {
  readonly slot: SlotRecord;
  readonly problem: SaveProblem;
}

interface BackupChoice {
  readonly slot: SlotRecord;
  readonly backup: BackupMeta;
}

/**
 * The saved games, newest first, at `/load`. Each slot loads in the engine worker (with its
 * checks), exports as an `.rbsave` file, lists its backups or is deleted after a confirmation.
 * "Import save" adds a file as a new slot. A save that will not load opens a report of the stage
 * and the issues instead of crashing anything.
 */
export function SaveSlotsScreen() {
  useDocumentTitle('Saved games');
  const location = useLocation();
  const navigate = useNavigate();
  const announce = useAnnounce();
  const saveSlots = useSaveSlots();
  const { loadSlot, pending } = useLoadGame();
  const [now] = useState(() => new Date());

  const initialHighlight = highlightFrom(location.state);
  const [highlightedSlotId, setHighlightedSlotId] = useState<string | null>(
    initialHighlight?.highlightSlotId ?? null,
  );
  const [loadError, setLoadError] = useState<SlotLoadError | null>(null);
  const [importError, setImportError] = useState<SaveProblem | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<ReadonlyMap<string, LoadFailureStage>>(new Map());
  const [deleteTarget, setDeleteTarget] = useState<SlotRecord | null>(null);
  const [backupsSlot, setBackupsSlot] = useState<SlotRecord | null>(null);
  const [backupChoice, setBackupChoice] = useState<BackupChoice | null>(null);
  const [exportingSlotId, setExportingSlotId] = useState<string | null>(null);
  const cardElements = useRef(new Map<string, HTMLElement>());

  // An import on the title screen arrives here with the new slot to point out.
  const importedLabel = initialHighlight?.importedLabel;
  useEffect(() => {
    if (importedLabel !== undefined) announce(`Imported ${importedLabel}`);
  }, [announce, importedLabel]);

  const { slots } = saveSlots;
  useEffect(() => {
    if (highlightedSlotId === null) return;
    cardElements.current.get(highlightedSlotId)?.scrollIntoView({ block: 'nearest' });
  }, [highlightedSlotId, slots]);

  const importSave = useImportSave(saveSlots.importFile, (result) => {
    if (result.ok) {
      setImportError(null);
      setHighlightedSlotId(result.slot.slotId);
      announce(`Imported ${result.slot.label}`);
    } else {
      setImportError(importProblem(result));
    }
  });

  const startLoad = async (slot: SlotRecord): Promise<void> => {
    setActionError(null);
    const failure = await loadSlot(slot.slotId, 'latest');
    if (failure === null) return;
    if (failure.stage !== 'storage' && UNREADABLE_STAGES.has(failure.stage)) {
      setUnreadable((current) => new Map(current).set(slot.slotId, failure.stage));
    }
    setLoadError({ slot, problem: failure });
  };

  const startExport = async (slot: SlotRecord): Promise<void> => {
    setActionError(null);
    setExportingSlotId(slot.slotId);
    try {
      const exported = await saveSlots.exportSlot(slot.slotId);
      if (!exported.ok) setActionError(`Couldn't export ${slot.label}: ${exported.error.message}`);
    } finally {
      setExportingSlotId(null);
    }
  };

  const confirmDelete = async (slot: SlotRecord): Promise<void> => {
    const deleted = await saveSlots.deleteSlot(slot.slotId);
    if (!deleted.ok) throw new Error(deleted.error.message);
    announce(`Deleted ${slot.label}`);
  };

  const confirmBackupLoad = async ({ slot, backup }: BackupChoice): Promise<void> => {
    const failure = await loadSlot(slot.slotId, backup.kind);
    if (failure === null) return;
    setBackupsSlot(null);
    setLoadError({ slot, problem: failure });
  };

  const listState = saveSlots.state;

  return (
    <div className={styles['screen']} aria-busy={pending !== null ? true : undefined}>
      <header className={styles['header']}>
        <div className={styles['headerText']}>
          <Link to={routes.title()} className={styles['backLink']}>
            <Icon name="home" size="sm" className={styles['backIcon']} decorative />
            Main menu
          </Link>
          <RouteHeading className={styles['heading']}>Saved games</RouteHeading>
        </div>
        <Button iconStart="upload" loading={importSave.importing} onClick={importSave.openPicker}>
          Import save
        </Button>
        {importSave.fileInput}
      </header>

      {actionError !== null && (
        <p className={styles['actionError']} role="alert">
          {actionError}
        </p>
      )}

      {listState.status === 'loading' && (
        <p className={styles['listStatus']} role="status">
          Loading saved games…
        </p>
      )}

      {listState.status === 'error' && (
        <div className={styles['listError']} role="alert">
          <p>{listState.error.message}</p>
          <Button
            size="sm"
            onClick={() => {
              void saveSlots.refresh();
            }}
          >
            Try again
          </Button>
        </div>
      )}

      {listState.status === 'ready' && slots.length === 0 && (
        <EmptyState
          size="page"
          icon="file-text"
          title="No saved games yet"
          body="Start a new game, or import an .rbsave file from another device."
          headingLevel={2}
          action={
            <Button
              variant="primary"
              iconStart="add"
              onClick={() => {
                navigate(routes.newGame());
              }}
            >
              New game
            </Button>
          }
        />
      )}

      {slots.length > 0 && (
        <ul className={styles['slotList']} aria-label="Saved games">
          {slots.map((slot) => (
            <li key={slot.slotId}>
              <SaveSlotCard
                ref={(element) => {
                  if (element === null) cardElements.current.delete(slot.slotId);
                  else cardElements.current.set(slot.slotId, element);
                }}
                slot={slot}
                now={now}
                unreadableStage={unreadable.get(slot.slotId) ?? null}
                loading={pending?.slotId === slot.slotId}
                loadDisabled={pending !== null && pending.slotId !== slot.slotId}
                exporting={exportingSlotId === slot.slotId}
                highlighted={highlightedSlotId === slot.slotId}
                onLoad={() => {
                  void startLoad(slot);
                }}
                onExport={() => {
                  void startExport(slot);
                }}
                onBackups={() => {
                  setBackupsSlot(slot);
                }}
                onDelete={() => {
                  setDeleteTarget(slot);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <LoadErrorSheet
        problem={loadError?.problem ?? null}
        title={loadError === null ? '' : `Couldn't load ${loadError.slot.label}`}
        onClose={() => {
          setLoadError(null);
        }}
        exporting={loadError !== null && exportingSlotId === loadError.slot.slotId}
        {...(loadError === null
          ? {}
          : {
              onExport: () => {
                void startExport(loadError.slot);
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
      <BackupsSheet
        slot={backupsSlot}
        now={now}
        onClose={() => {
          setBackupsSlot(null);
        }}
        onChooseBackup={(backup) => {
          if (backupsSlot !== null) setBackupChoice({ slot: backupsSlot, backup });
        }}
      />
      <ConfirmDialog
        open={backupChoice !== null}
        onClose={() => {
          setBackupChoice(null);
        }}
        onConfirm={async () => {
          if (backupChoice !== null) await confirmBackupLoad(backupChoice);
        }}
        title="Load this backup?"
        body={
          backupChoice === null
            ? ''
            : `Load the backup from ${formatGameDate(backupChoice.backup.gameDate)}? Your latest save stays in the slot until you save over it.`
        }
        confirmLabel="Load backup"
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        onClose={() => {
          setDeleteTarget(null);
        }}
        onConfirm={async () => {
          if (deleteTarget !== null) await confirmDelete(deleteTarget);
        }}
        title={deleteTarget === null ? '' : `Delete ${deleteTarget.label}?`}
        body="This also deletes its backups. This can't be undone."
        confirmLabel="Delete"
      />
    </div>
  );
}
