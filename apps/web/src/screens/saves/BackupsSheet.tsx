import { Button } from '@/components/Button';
import { formatGameDate } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import { Sheet } from '@/components/Sheet';
import type { BackupMeta, SlotRecord } from '@/storage';
import styles from './SaveSlotsScreen.module.css';
import { BACKUP_REASON_LABELS, formatRelativeTime, formatSaveSize } from './slotFormat';

export interface BackupsSheetProps {
  /** The slot whose backups to list; the sheet is closed while it is null. */
  readonly slot: SlotRecord | null;
  readonly now: Date;
  readonly onClose: () => void;
  /** Asks to load a backup. The screen confirms first. */
  readonly onChooseBackup: (backup: BackupMeta) => void;
}

/**
 * A slot's rotating backups, newest first: the game date each one holds, when it was saved and
 * why, each with "Load this backup". Opens from the side on desktop and from the bottom on phones.
 */
export function BackupsSheet({ slot, now, onClose, onChooseBackup }: BackupsSheetProps) {
  return (
    <Sheet
      open={slot !== null}
      onClose={onClose}
      title={slot === null ? 'Backups' : `Backups of ${slot.label}`}
      side="right"
      size="md"
    >
      {slot !== null && (
        <div className={styles['backupsBody']}>
          <p className={styles['backupsIntro']}>
            Each save keeps its last three versions. Loading one leaves your latest save in the slot
            until you save over it.
          </p>
          {slot.backups.length === 0 ? (
            <p className={styles['backupsEmpty']}>This save has no backups yet.</p>
          ) : (
            <ul className={styles['backupList']}>
              {slot.backups.map((backup) => (
                <li key={backup.kind} className={styles['backup']} data-backup-kind={backup.kind}>
                  <div className={styles['backupInfo']}>
                    <p className={styles['backupDate']}>{formatGameDate(backup.gameDate)}</p>
                    <p className={styles['backupMeta']}>
                      {BACKUP_REASON_LABELS[backup.reason]} · saved{' '}
                      <time dateTime={backup.savedAt}>
                        {formatRelativeTime(backup.savedAt, now)}
                      </time>{' '}
                      · {formatSaveSize(backup.sizeBytes)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    iconStart="history"
                    onClick={() => {
                      onChooseBackup(backup);
                    }}
                  >
                    Load this backup
                    <VisuallyHidden> from {formatGameDate(backup.gameDate)}</VisuallyHidden>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}
