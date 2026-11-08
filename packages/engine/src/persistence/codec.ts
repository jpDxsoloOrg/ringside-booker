/**
 * The save codec: a save document to bytes and back.
 *
 * Encoding writes the document as canonical JSON (object keys sorted, no whitespace), encodes it as
 * UTF-8 and gzips it with the platform's `CompressionStream`. The same document always gives the
 * same bytes, whatever order its keys were created in, so two runs that reach the same state save
 * byte-identical files. An `.rbsave` file is exactly these bytes.
 *
 * Decoding accepts gzip (detected by its magic bytes `1f 8b`) or plain UTF-8 JSON starting with `{`,
 * the uncompressed form debug exports use. It never throws: problems come back as a `decode`-stage
 * failure. Anything over `MAX_SAVE_BYTES` once unpacked is refused, and decompression stops as soon
 * as it passes the limit.
 *
 * `CompressionStream`, `DecompressionStream`, `TextEncoder` and `TextDecoder` exist in browsers, Web
 * Workers and Node 20, so headless tools read and write the same files as the game.
 */

import { assertJsonValue, isJsonArray, type JsonValue } from '../core/json';
import { singleIssueFailure, type LoadResult } from './report';
import type { SaveDocument } from './save-document';

/** The largest save accepted, measured as unpacked JSON: 128 MB. */
export const MAX_SAVE_BYTES = 128 * 1024 * 1024;

const GZIP_MAGIC_FIRST = 0x1f;
const GZIP_MAGIC_SECOND = 0x8b;
const OPEN_BRACE = 0x7b;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
/** Space, tab, line feed and carriage return: JSON's whitespace. */
const JSON_WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

export interface DecodeOptions {
  /** Overrides `MAX_SAVE_BYTES`, for tests. */
  readonly maxBytes?: number;
}

/** The same value with every object's keys in sorted (UTF-16 code unit) order. */
function sortKeys(value: JsonValue): JsonValue {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (isJsonArray(value)) {
    return value.map(sortKeys);
  }
  // Object.fromEntries defines own properties, so a `__proto__` key loaded from a save is written
  // back out instead of silently replacing the object's prototype.
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key): [string, JsonValue] => [key, sortKeys(value[key] ?? null)]),
  );
}

/**
 * The document as canonical JSON: keys sorted at every level, compact unless `indent` is given
 * (the golden fixtures use 2). Throws `NotSerialisableError` naming the first bad path when the
 * document holds anything that is not plain JSON, such as `NaN`, `Infinity`, `undefined` or a
 * `Map`. Schemas already reject those; this guards documents built by hand or by code that
 * skipped validation.
 */
export function serialiseSaveDocument(doc: SaveDocument, indent?: number): string {
  assertJsonValue(doc, 'save');
  return JSON.stringify(sortKeys(doc), null, indent);
}

/** Resolves to the error `write` and `close` failed with, or null when both succeeded. */
async function writeAndClose(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  input: Uint8Array,
): Promise<{ readonly error: unknown } | null> {
  try {
    await writer.write(input);
    await writer.close();
    return null;
  } catch (error: unknown) {
    return { error };
  }
}

function concatChunks(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const joined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

/**
 * Pushes `input` through a compression or decompression stream and collects the output. Returns
 * null, after cancelling the stream, as soon as the output passes `maxOutputBytes`. Rejects with
 * the stream's error for damaged input.
 */
async function transformBytes(
  stream: CompressionStream | DecompressionStream,
  input: Uint8Array,
  maxOutputBytes: number,
): Promise<Uint8Array | null> {
  const writing = writeAndClose(stream.writable.getWriter(), input);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalLength += result.value.length;
    if (totalLength > maxOutputBytes) {
      await reader.cancel('the output is over the size limit');
      return null;
    }
    chunks.push(result.value);
  }
  const writeFailure = await writing;
  if (writeFailure !== null) {
    throw writeFailure.error;
  }
  return concatChunks(chunks, totalLength);
}

/**
 * Encodes a save document: canonical JSON, UTF-8, gzip. The same document always gives the same
 * bytes. Throws `NotSerialisableError` when the document is not plain JSON.
 */
export async function encodeSave(doc: SaveDocument): Promise<Uint8Array> {
  const json = new TextEncoder().encode(serialiseSaveDocument(doc));
  const compressed = await transformBytes(
    new CompressionStream('gzip'),
    json,
    Number.POSITIVE_INFINITY,
  );
  if (compressed === null) {
    // Unreachable with an infinite limit; keeps the result type honest.
    throw new Error('encodeSave: compression produced no output');
  }
  return compressed;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes[0] === GZIP_MAGIC_FIRST && bytes[1] === GZIP_MAGIC_SECOND;
}

/** True when the first byte after an optional UTF-8 BOM and any whitespace is `{`. */
function startsLikeJsonObject(bytes: Uint8Array): boolean {
  let index = UTF8_BOM.every((byte, offset) => bytes[offset] === byte) ? UTF8_BOM.length : 0;
  while (index < bytes.length && JSON_WHITESPACE.has(bytes[index] ?? -1)) {
    index += 1;
  }
  return bytes[index] === OPEN_BRACE;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tooLarge(maxBytes: number): LoadResult<never> {
  const megabytes = Math.floor(maxBytes / (1024 * 1024));
  return singleIssueFailure(
    'decode',
    '',
    `The save is larger than ${String(megabytes)} MB once unpacked, which is more than any real save. The file is probably damaged.`,
  );
}

/**
 * Decodes save bytes into the document's JSON text. Accepts gzip or plain UTF-8 JSON starting with
 * `{`. Never throws; an empty, damaged, truncated, oversized or non-UTF-8 file comes back as a
 * `decode`-stage failure.
 */
export async function decodeSave(
  bytes: Uint8Array,
  options: DecodeOptions = {},
): Promise<LoadResult<string>> {
  const maxBytes = options.maxBytes ?? MAX_SAVE_BYTES;
  if (bytes.length === 0) {
    return singleIssueFailure('decode', '', 'The file is empty.');
  }

  let json: Uint8Array;
  if (isGzip(bytes)) {
    let unpacked: Uint8Array | null;
    try {
      unpacked = await transformBytes(new DecompressionStream('gzip'), bytes, maxBytes);
    } catch (error: unknown) {
      return singleIssueFailure(
        'decode',
        '',
        `The save could not be unpacked; it is damaged or incomplete (${describeError(error)}).`,
      );
    }
    if (unpacked === null) {
      return tooLarge(maxBytes);
    }
    json = unpacked;
  } else if (startsLikeJsonObject(bytes)) {
    if (bytes.length > maxBytes) {
      return tooLarge(maxBytes);
    }
    json = bytes;
  } else {
    return singleIssueFailure(
      'decode',
      '',
      'This is not a Ringside Booker save: it is neither a compressed save nor JSON.',
    );
  }

  try {
    return { ok: true, value: new TextDecoder('utf-8', { fatal: true }).decode(json) };
  } catch (error: unknown) {
    return singleIssueFailure(
      'decode',
      '',
      `The save is not valid UTF-8 text (${describeError(error)}).`,
    );
  }
}
