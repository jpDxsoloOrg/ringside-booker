/**
 * Gzips a value's JSON (or a raw string) the way an `.rbsave` is packed, with no checks, so tests
 * can hand the loader documents the encoder would refuse. Node only; not exported from the testing
 * entry, which the web app's tests also load.
 */

import { gzipSync } from 'node:zlib';

export function gzipJson(value: unknown): Uint8Array {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new Uint8Array(gzipSync(Buffer.from(text, 'utf8')));
}
