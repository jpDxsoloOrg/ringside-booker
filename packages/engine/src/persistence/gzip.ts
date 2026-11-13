/**
 * Gzip for the save codec: the platform's `CompressionStream` where it exists, and fflate where it
 * does not. iOS Safari only has `CompressionStream` from 16.4, and every iPhone browser is Safari
 * underneath, so without the fallback an older iPhone could not save or load a game (UI-30).
 *
 * Both paths write standard gzip, so a save written by either one loads with the other. The
 * fallback's bytes differ from the platform's, so the "same document, same bytes" promise holds
 * per browser, not across them.
 */

import { Gunzip, gzipSync } from 'fflate';

/** How much compressed input the fallback unpacks at a time before checking the size limit. */
const FALLBACK_SLICE_BYTES = 64 * 1024;

/** Which gzip implementation to use. Tests pass `fallback` to cover older browsers. */
export type GzipEngine = 'platform' | 'fallback';

/** `platform` when this runtime has `CompressionStream` and `DecompressionStream`. */
export function defaultGzipEngine(): GzipEngine {
  // `typeof` on an undeclared global is safe, so this runs where the streams are missing.
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
    ? 'platform'
    : 'fallback';
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

/** Gzips `input`. */
export async function gzip(
  input: Uint8Array,
  engine: GzipEngine = defaultGzipEngine(),
): Promise<Uint8Array> {
  if (engine === 'fallback') {
    return gzipSync(input);
  }
  const compressed = await transformBytes(
    new CompressionStream('gzip'),
    input,
    Number.POSITIVE_INFINITY,
  );
  if (compressed === null) {
    // Unreachable with an infinite limit; keeps the result type honest.
    throw new Error('gzip: compression produced no output');
  }
  return compressed;
}

/** Unpacks gzip with fflate, a slice at a time, stopping once the output passes the limit. */
function gunzipFallback(input: Uint8Array, maxOutputBytes: number): Uint8Array | null {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  let finished = false;
  const unpacker = new Gunzip((chunk, final) => {
    totalLength += chunk.length;
    chunks.push(chunk);
    if (final) finished = true;
  });
  for (let start = 0; start < input.length; start += FALLBACK_SLICE_BYTES) {
    const end = Math.min(start + FALLBACK_SLICE_BYTES, input.length);
    unpacker.push(input.subarray(start, end), end === input.length);
    if (totalLength > maxOutputBytes) return null;
  }
  if (!finished) {
    throw new Error('unexpected end of file');
  }
  return concatChunks(chunks, totalLength);
}

/**
 * Unpacks gzip. Returns null as soon as the output passes `maxOutputBytes`; rejects for damaged
 * or truncated input.
 */
export async function gunzip(
  input: Uint8Array,
  maxOutputBytes: number,
  engine: GzipEngine = defaultGzipEngine(),
): Promise<Uint8Array | null> {
  if (engine === 'fallback') {
    return gunzipFallback(input, maxOutputBytes);
  }
  return transformBytes(new DecompressionStream('gzip'), input, maxOutputBytes);
}
