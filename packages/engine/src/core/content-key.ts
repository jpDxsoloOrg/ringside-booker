/**
 * Content keys.
 *
 * A `ContentKey` names an entry in a data-pack catalog, such as `gimmick.monster-heel` or
 * `finish.pinfall`: a lowercase namespace followed by one or more dot-separated segments. The
 * catalogs belong to other systems, so the World stores keys without checking they resolve; the
 * data-pack loader does that.
 */

import type { Brand } from './brand';
import { InvalidContentKeyError } from './errors';

export type ContentKey = Brand<string, 'ContentKey'>;

export const CONTENT_KEY_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** True when `value` is a well-formed content key. */
export function isContentKey(value: unknown): value is ContentKey {
  return typeof value === 'string' && CONTENT_KEY_PATTERN.test(value);
}

/** Returns `value` as a ContentKey, or throws `InvalidContentKeyError`. */
export function parseContentKey(value: unknown): ContentKey {
  if (!isContentKey(value)) {
    throw new InvalidContentKeyError(value);
  }
  return value;
}
