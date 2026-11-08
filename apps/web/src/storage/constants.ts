/**
 * The numbers and names save storage is built on, in one place so the policy, the rotation, the
 * file export and the tests all read the same values.
 */

/** The IndexedDB database that holds every save slot. */
export const SAVE_DB_NAME = 'ringside-booker';

/** The database schema version. Each bump adds a step to the upgrade switch in `db.ts`. */
export const SAVE_DB_VERSION = 1;

/** An autosave is written once at least this many in-game days passed since the last one. */
export const AUTOSAVE_EVERY_DAYS = 7;

/** The backup blobs, newest first. Rotation shifts each one a place to the right. */
export const BACKUP_KINDS = ['backup-1', 'backup-2', 'backup-3'] as const;

/** How many rotating backups each slot keeps next to its current save and its autosave (3). */
export const BACKUP_COUNT = BACKUP_KINDS.length;

/** The largest `.rbsave` file import accepts. Checked before the file is read. */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/** The extension of an exported save file. */
export const SAVE_FILE_EXTENSION = '.rbsave';

/** The media type of an exported save file. */
export const SAVE_FILE_MIME_TYPE = 'application/x-ringside-save';

/** The longest slug a save file name starts with. */
export const SAVE_FILE_SLUG_MAX_LENGTH = 40;
