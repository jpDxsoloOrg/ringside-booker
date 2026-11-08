/**
 * Save storage: IndexedDB save slots, autosave, rotating backups and `.rbsave` export and import.
 * See `README.md` next to this file.
 */

export {
  AUTOSAVE_EVERY_DAYS,
  BACKUP_COUNT,
  BACKUP_KINDS,
  MAX_IMPORT_BYTES,
  SAVE_DB_NAME,
  SAVE_DB_VERSION,
  SAVE_FILE_EXTENSION,
  SAVE_FILE_MIME_TYPE,
} from './constants';
export type {
  BackupKind,
  BackupMeta,
  BackupReason,
  BlobKind,
  BlobRecord,
  SaveDbSchema,
  SlotRecord,
} from './db';
export { closeSaveDb, openSaveDb, subscribeToStorageNotices } from './db';
export type {
  BlockedError,
  NotFoundError,
  QuotaError,
  ReadFailedError,
  StorageError,
  StorageErrorCode,
  StorageFailure,
  StorageResult,
  TooLargeError,
  UnavailableError,
  WriteFailedError,
} from './errors';
export { isStorageError } from './errors';
export type { AutosaveOptions, LoadedSave, LoadWhich, SaveBytesMeta } from './save-slots';
export {
  createSlot,
  deleteSlot,
  duplicateSlot,
  getSlot,
  listSlots,
  loadFromSlot,
  renameSlot,
  saveToSlot,
  writeAutosave,
} from './save-slots';
export type { AutosaveDecision, AutosaveInput, AutosaveReason } from './autosave-policy';
export { shouldAutosave } from './autosave-policy';
export type {
  DeliveryOutcome,
  ExportedSave,
  ImportResult,
  InspectFailure,
  InspectResult,
  InspectSave,
} from './export-import';
export {
  exportSlot,
  importSaveFile,
  saveFileName,
  slugifyLabel,
  triggerDownload,
} from './export-import';
export type { StorageUsage } from './persistence';
export { getStorageUsage, requestPersistentStorage } from './persistence';
