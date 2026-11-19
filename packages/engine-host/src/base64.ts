/**
 * Standard base64 (RFC 4648, with padding) for save bytes crossing the host boundary as text.
 * Written out here because `atob`/`btoa` and `Buffer` are browser and Node globals an embedded
 * runtime does not have.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Characters per `join` piece, so a large save never builds one huge array of single letters. */
const CHUNK_BYTES = 3 * 4096;

const DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let index = 0; index < ALPHABET.length; index += 1) {
    table[ALPHABET.charCodeAt(index)] = index;
  }
  return table;
})();

function letter(sextet: number): string {
  return ALPHABET.charAt(sextet & 0x3f);
}

export function encodeBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    const end = Math.min(start + CHUNK_BYTES, bytes.length);
    let piece = '';
    for (let index = start; index < end; index += 3) {
      const first = bytes[index] ?? 0;
      const second = bytes[index + 1];
      const third = bytes[index + 2];
      const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
      piece += letter(triple >> 18) + letter(triple >> 12);
      piece += second === undefined ? '=' : letter(triple >> 6);
      piece += third === undefined ? '=' : letter(triple);
    }
    parts.push(piece);
  }
  return parts.join('');
}

/** Decodes base64, ignoring whitespace. Throws a `TypeError` for anything else that is not base64. */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  const unpadded = clean.replace(/={1,2}$/, '');
  if (unpadded.length % 4 === 1) {
    throw new TypeError('The save text is not valid base64 (its length is wrong)');
  }
  const out = new Uint8Array(Math.floor((unpadded.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let length = 0;
  for (let index = 0; index < unpadded.length; index += 1) {
    const code = unpadded.charCodeAt(index);
    const value = code < 128 ? (DECODE_TABLE[code] ?? -1) : -1;
    if (value < 0) {
      throw new TypeError(`The save text is not valid base64 (bad character at ${String(index)})`);
    }
    buffer = ((buffer << 6) | value) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, length);
}
