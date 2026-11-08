/**
 * What can go wrong with save storage, as typed values the UI can turn into a message.
 *
 * No storage function throws a raw `DOMException` at its caller. Each one returns a
 * `StorageResult`: the value, or a `StorageError` whose `code` says what kind of problem it was.
 */

import type { LoadFailure } from '@ringside/engine';
import type { BlobKind } from './db';

export type StorageErrorCode =
  'quota' | 'notFound' | 'blocked' | 'unavailable' | 'tooLarge' | 'readFailed' | 'writeFailed';

interface StorageErrorBase<Code extends StorageErrorCode> {
  readonly code: Code;
  /** A plain-language description for logs and for the UI to fall back on. */
  readonly message: string;
}

/** The browser refused the write because the site's storage is full (`QuotaExceededError`). */
export type QuotaError = StorageErrorBase<'quota'>;

/** The slot, or the save kind asked for in it, does not exist. */
export interface NotFoundError extends StorageErrorBase<'notFound'> {
  readonly slotId: string;
  /** The save that was asked for, when the slot exists but that save does not. */
  readonly kind: BlobKind | null;
}

/**
 * Another tab holds the save database at a different version: an old tab is blocking an upgrade,
 * or a newer copy of the game upgraded it. Closing the other tab or reloading fixes it.
 */
export type BlockedError = StorageErrorBase<'blocked'>;

/** IndexedDB is missing or refused to open, as in some private browsing modes. */
export type UnavailableError = StorageErrorBase<'unavailable'>;

/** A file is over the import limit. It was not read. */
export interface TooLargeError extends StorageErrorBase<'tooLarge'> {
  readonly sizeBytes: number;
  readonly limitBytes: number;
}

/** Reading a file or the database failed for a reason other than the ones above. */
export type ReadFailedError = StorageErrorBase<'readFailed'>;

/** Writing to the database failed for a reason other than a full disk. Nothing was changed. */
export type WriteFailedError = StorageErrorBase<'writeFailed'>;

export type StorageError =
  | QuotaError
  | NotFoundError
  | BlockedError
  | UnavailableError
  | TooLargeError
  | ReadFailedError
  | WriteFailedError;

export interface StorageFailure {
  readonly ok: false;
  readonly error: StorageError;
}

export type StorageResult<T> = { readonly ok: true; readonly value: T } | StorageFailure;

export function storageSuccess<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function storageFailure(error: StorageError): StorageFailure {
  return { ok: false, error };
}

export function notFoundError(slotId: string, kind: BlobKind | null = null): NotFoundError {
  return {
    code: 'notFound',
    message:
      kind === null
        ? `Save slot ${slotId} does not exist.`
        : `Save slot ${slotId} has no ${kind} save.`,
    slotId,
    kind,
  };
}

/**
 * Carries a `StorageError` out of a transaction body. Throwing it aborts the transaction, so a
 * failed check (such as a missing slot) rolls back every write made before it.
 */
export class StorageErrorSignal extends Error {
  readonly storageError: StorageError;

  constructor(storageError: StorageError) {
    super(storageError.message);
    this.name = 'StorageErrorSignal';
    this.storageError = storageError;
  }
}

function errorName(error: unknown): string | null {
  if (error instanceof Error || error instanceof DOMException) {
    return error.name;
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error || error instanceof DOMException) {
    return error.message;
  }
  return String(error);
}

/** Error names browsers use for a full disk. Firefox has used its own name in the past. */
const QUOTA_ERROR_NAMES: ReadonlySet<string> = new Set([
  'QuotaExceededError',
  'NS_ERROR_DOM_QUOTA_REACHED',
]);

/**
 * Turns anything a storage call threw into a `StorageError`. A full disk is always `quota` and a
 * database newer than this build is `blocked`; anything else becomes `fallback`, which the caller
 * picks for the operation that failed (`readFailed` for a read, `writeFailed` for a write).
 */
export function toStorageError(
  error: unknown,
  fallback: 'readFailed' | 'writeFailed' | 'unavailable',
): StorageError {
  if (error instanceof StorageErrorSignal) {
    return error.storageError;
  }
  const name = errorName(error);
  const detail = errorMessage(error);
  if (name !== null && QUOTA_ERROR_NAMES.has(name)) {
    return {
      code: 'quota',
      message: `The browser has no room left for saves (${detail}). Delete or export old saves.`,
    };
  }
  if (name === 'VersionError') {
    return {
      code: 'blocked',
      message: `A newer version of the game changed the save database (${detail}). Reload the page.`,
    };
  }
  switch (fallback) {
    case 'readFailed':
      return { code: 'readFailed', message: `Reading saves failed: ${detail}` };
    case 'writeFailed':
      return { code: 'writeFailed', message: `Saving failed and nothing was changed: ${detail}` };
    case 'unavailable':
      return {
        code: 'unavailable',
        message: `This browser does not allow saves here (${detail}). Private browsing can cause this.`,
      };
  }
}

/** True for a storage error, false for any other failure (such as an engine load failure). */
export function isStorageError(error: StorageError | LoadFailure): error is StorageError {
  return 'code' in error;
}
