# Save storage

Save slots in the browser: IndexedDB (through `idb`), an autosave per slot,
three rotating backups and `.rbsave` export and import. Storage keeps bytes
safe and never looks inside them apart from the header the caller passes in.
The engine produces and checks the bytes (`encodeSave`, `inspectSave`,
`loadSave`; see `docs/design/save-format.md`). A save from an older build that
no longer loads is explained, not listed as errors: see "Older builds" there.

Everything is exported from `index.ts`. No function throws at its caller: each
returns a `StorageResult` (`{ ok: true, value }` or `{ ok: false, error }`),
and every `StorageError` has a `code` the UI turns into a message:

| Code          | Meaning                                                              |
| ------------- | -------------------------------------------------------------------- |
| `quota`       | The browser is out of room for this site (`QuotaExceededError`)      |
| `notFound`    | The slot, or the save asked for in it, does not exist                |
| `blocked`     | Another tab holds the database at a different version                |
| `unavailable` | No IndexedDB, or it refused to open (some private browsing modes)    |
| `tooLarge`    | An imported file is over 64 MB; it was not read                      |
| `readFailed`  | Reading a file or the database failed for another reason             |
| `writeFailed` | A write failed for another reason; the transaction rolled back whole |

`importSaveFile` can also fail with the engine's inspect failure (it has a
`stage` instead of a `code`); `isStorageError` tells them apart.

## Stores

Database `ringside-booker`, version 1. Upgrades run one version step at a time
from a switch in `db.ts`; a new version adds a case and never edits old ones.

- **`slots`** (key `slotId`, index `byUpdatedAt`): one `SlotRecord` per slot,
  everything a slot list shows: label, the newest save's header, times, format
  and engine version, sizes and the backup list.
- **`blobs`** (key `[slotId, kind]`, index `bySlot`): the bytes. `kind` is
  `current`, `autosave`, `backup-1`, `backup-2` or `backup-3`.
- **`meta`** (out-of-line keys): facts about the database itself. Today only
  `persistence`, the answer to the persistent storage request.

## Saves and rotation

- **Manual save** (`saveToSlot`): in one transaction, `backup-2 → backup-3`,
  `backup-1 → backup-2`, `current → backup-1` (reason `manualSave`), then the
  new bytes become `current` and the slot record is updated. The old `backup-3`
  is dropped.
- **Autosave** (`writeAutosave`): writes `autosave`. With `monthlyBackup`, the
  newer of `current` and `autosave` is first rotated into the backups the same
  way (reason `monthly`).
- **Load** (`loadFromSlot`): `latest` is the newer of `current` and `autosave`
  by `savedAt` (the manual save wins a tie); any single kind can be asked for.

Backups are full copies written in the same transaction as the save, so every
one of them loads. If anything fails part-way, the transaction is aborted and
the slot keeps its previous `current` and backups.

`shouldAutosave` decides when to autosave: after every completed player show,
once 7 or more in-game days have passed, when the game month changes (with
`monthlyBackup`), and when the page is hidden (best effort). The constants
(`AUTOSAVE_EVERY_DAYS`, `BACKUP_COUNT`, `MAX_IMPORT_BYTES`, ...) live in
`constants.ts`.

## Export and import

- `exportSlot(slotId, which)` returns `<slug(label)>-<gameDate>.rbsave` and a
  `Blob` of exactly the stored bytes (type `application/x-ringside-save`).
- `triggerDownload(fileName, blob)` opens the share sheet where files can be
  shared (phones) and downloads the file otherwise.
- `importSaveFile(file, inspect)` refuses files over 64 MB before reading them,
  checks the bytes with the injected `inspect` (the engine's `inspectSave`) and
  creates a **new** slot labelled `<header label> (imported)`. It never
  overwrites a slot.

## Who calls what, and where

The UI's worker host decides where storage runs. The recommended split keeps
large byte arrays off the main thread:

| Function                                                    | Runs in                   | Called by                                 |
| ----------------------------------------------------------- | ------------------------- | ----------------------------------------- |
| Slot CRUD, `saveToSlot`, `writeAutosave`, `loadFromSlot`    | Engine worker             | Worker host, after encoding / to load     |
| `shouldAutosave`                                            | Engine worker             | Worker host after each day advance        |
| `exportSlot`                                                | Engine worker             | Export screen; only the `Blob` crosses    |
| `importSaveFile`                                            | Whichever side has `File` | Import screen, with the worker's inspect  |
| `triggerDownload`                                           | Main thread (needs DOM)   | Export screen, straight from the click    |
| `requestPersistentStorage`                                  | Main thread               | UI after a save succeeds (asks only once) |
| `getStorageUsage`, `listSlots`, `subscribeToStorageNotices` | Either                    | Slot screens, settings                    |

Notes for callers:

- **Share needs a user gesture.** Browsers only open the share sheet during a
  click, so export the slot before the player taps "Export" (for example when
  the export sheet opens) and call `triggerDownload` directly in the handler.
- **`navigator.storage.persist()` is main-thread only.** Called from a worker,
  `requestPersistentStorage` returns `null` and asks nothing, so a later call
  from the main thread still asks.
- **Persisting is not guaranteed.** iOS Safari can still clear site data after
  weeks without a visit, so the UI should nudge phone players to export now
  and then.
- **Several tabs.** Two tabs writing the same slot race, and the last write
  wins. When another tab needs a newer database version, this tab closes its
  connection and `subscribeToStorageNotices` listeners get a `blocked` notice.
  The next storage call opens the database again.
