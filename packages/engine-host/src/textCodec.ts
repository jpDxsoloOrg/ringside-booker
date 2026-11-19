/**
 * UTF-8 `TextEncoder` and `TextDecoder` for JavaScript runtimes that have none (an embedded engine
 * such as Jint or a bare V8 isolate has only the language built-ins). The save codec is their only
 * user: it encodes a save document's JSON to bytes and decodes it back with `fatal: true`.
 *
 * Only what the engine needs: UTF-8, `encode(string)`, and `decode(bytes)` that skips a leading
 * byte-order mark and, with `fatal`, throws a `TypeError` for malformed input (otherwise each bad
 * sequence becomes U+FFFD). Lone surrogates in a string encode as U+FFFD, as the web's encoder does.
 */

const REPLACEMENT = 0xfffd;
/** How many code units go to one `String.fromCharCode` call, well under any engine's argument cap. */
const CHUNK_UNITS = 8192;

export function encodeUtf8(text: string): Uint8Array {
  // At most three bytes per UTF-16 code unit.
  const out = new Uint8Array(text.length * 3);
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (code >= 0xd800 && code <= 0xdfff) code = REPLACEMENT;
    if (code < 0x80) {
      out[length++] = code;
    } else if (code < 0x800) {
      out[length++] = 0xc0 | (code >> 6);
      out[length++] = 0x80 | (code & 0x3f);
    } else if (code < 0x10000) {
      out[length++] = 0xe0 | (code >> 12);
      out[length++] = 0x80 | ((code >> 6) & 0x3f);
      out[length++] = 0x80 | (code & 0x3f);
    } else {
      out[length++] = 0xf0 | (code >> 18);
      out[length++] = 0x80 | ((code >> 12) & 0x3f);
      out[length++] = 0x80 | ((code >> 6) & 0x3f);
      out[length++] = 0x80 | (code & 0x3f);
    }
  }
  return out.slice(0, length);
}

/** The byte count and smallest code point of a lead byte's sequence, or null for a bad lead byte. */
function sequenceOf(lead: number): { readonly size: number; readonly min: number } | null {
  if (lead >= 0xc2 && lead <= 0xdf) return { size: 2, min: 0x80 };
  if (lead >= 0xe0 && lead <= 0xef) return { size: 3, min: 0x800 };
  if (lead >= 0xf0 && lead <= 0xf4) return { size: 4, min: 0x10000 };
  return null;
}

export function decodeUtf8(bytes: Uint8Array, fatal: boolean): string {
  const units: number[] = [];
  const parts: string[] = [];
  const flush = (): void => {
    parts.push(String.fromCharCode(...units));
    units.length = 0;
  };
  const bad = (): void => {
    if (fatal) throw new TypeError('The encoded data was not valid utf-8');
    units.push(REPLACEMENT);
  };

  let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (index < bytes.length) {
    const lead = bytes[index] ?? 0;
    if (lead < 0x80) {
      units.push(lead);
      index += 1;
    } else {
      const sequence = sequenceOf(lead);
      if (sequence === null) {
        bad();
        index += 1;
      } else {
        let code = lead & (0xff >> (sequence.size + 1));
        let used = 1;
        while (used < sequence.size) {
          const next = bytes[index + used];
          if (next === undefined || (next & 0xc0) !== 0x80) break;
          code = (code << 6) | (next & 0x3f);
          used += 1;
        }
        if (used < sequence.size || code < sequence.min || code > 0x10ffff) {
          bad();
          index += Math.max(1, used);
        } else if (code >= 0xd800 && code <= 0xdfff) {
          bad();
          index += used;
        } else {
          if (code >= 0x10000) {
            const offset = code - 0x10000;
            units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
          } else {
            units.push(code);
          }
          index += used;
        }
      }
    }
    if (units.length >= CHUNK_UNITS) flush();
  }
  flush();
  return parts.join('');
}

/** A UTF-8-only stand-in for the web's `TextEncoder`. */
export class Utf8TextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    return encodeUtf8(input);
  }
}

/** A UTF-8-only stand-in for the web's `TextDecoder`. Other labels throw a `RangeError`. */
export class Utf8TextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal: boolean;

  constructor(label = 'utf-8', options: { readonly fatal?: boolean } = {}) {
    const normalised = label.trim().toLowerCase();
    if (normalised !== 'utf-8' && normalised !== 'utf8' && normalised !== 'unicode-1-1-utf-8') {
      throw new RangeError(`This runtime's TextDecoder only supports utf-8, not "${label}"`);
    }
    this.fatal = options.fatal ?? false;
  }

  decode(input?: ArrayBufferView | ArrayBuffer): string {
    if (input === undefined) return '';
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return decodeUtf8(bytes, this.fatal);
  }
}
