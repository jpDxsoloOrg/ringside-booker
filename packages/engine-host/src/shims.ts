/**
 * Fills in the few platform globals the engine reaches for that are not part of the JavaScript
 * language itself, so the bundle runs in a bare embedded runtime (no DOM, no Node).
 *
 * - `TextEncoder` / `TextDecoder`: the save codec turns the save document's JSON into UTF-8 and
 *   back. Replaced by a UTF-8-only version (`textCodec.ts`) when missing.
 * - Gzip needs nothing: without `CompressionStream` the engine already uses its bundled fflate.
 *
 * A runtime that has the real globals keeps them. This module is imported first by the bundle entry,
 * before any engine module runs.
 */

import { Utf8TextDecoder, Utf8TextEncoder } from './textCodec';

/** Which shims were installed, for `RingsideEngine.info()`. */
export const installedShims: string[] = [];

function install(name: 'TextEncoder' | 'TextDecoder', value: unknown): void {
  if (typeof Reflect.get(globalThis, name) === 'function') return;
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  installedShims.push(name);
}

install('TextEncoder', Utf8TextEncoder);
install('TextDecoder', Utf8TextDecoder);
