/**
 * Picture references for workshop world mods.
 *
 * A mod's pictures stay where they are: the game reads them in place from the mod's picture folder
 * (`gameworld.imageFolder`) when it shows them, and never copies or bundles them. A record's
 * `imageRef`/`logoRef` must match the engine's relative-path pattern (letters, digits, `.`, `_`,
 * `-` and `/` only), but mod file names hold spaces, `%` escapes and other characters. So the
 * converter writes a reversible encoding of the path relative to the picture folder, under the
 * prefix `wm/`:
 *
 * - letters, digits, `.` and `-` stay as they are;
 * - `_` becomes `__`;
 * - a space becomes `_s`;
 * - any other character becomes `_x` + its code point in hex + `_` (`(` is `_x28_`).
 *
 * `people/Big Dog (2).png` becomes `wm/people/Big_sDog_s_x28_2_x29_.png`. The C# side decodes it
 * with the same rules (`PictureRef.Decode` in game/Assets/Scripts/Import), so a save carries
 * everything the game needs to find a picture again.
 */

export const WORLD_MOD_IMAGE_PREFIX = 'wm/';

const KEPT = /^[A-Za-z0-9.-]$/;

function encodeSegment(segment: string): string {
  let out = '';
  for (const char of segment) {
    if (KEPT.test(char)) out += char;
    else if (char === '_') out += '__';
    else if (char === ' ') out += '_s';
    else out += `_x${(char.codePointAt(0) ?? 0).toString(16)}_`;
  }
  // A segment may not start with `.` (the engine pattern), and `..` must never appear.
  return out.startsWith('.') ? `_x2e_${out.slice(1)}` : out;
}

/** Undoes `%XX` escapes the mods use in some file names (`A%2002.png` is `A 02.png`). */
export function decodePercent(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/**
 * The image reference for `folder/file` inside the mod's picture folder, or null when there is no
 * file. `file` is percent-decoded first.
 */
export function encodeWorldModImageRef(folder: string, file: string | null): string | null {
  if (file === null) return null;
  const decoded = decodePercent(file).replace(/\\/g, '/');
  const segments = [folder, ...decoded.split('/')].filter(
    (segment) => segment !== '' && segment !== '.' && segment !== '..',
  );
  if (segments.length < 2) return null;
  return WORLD_MOD_IMAGE_PREFIX + segments.map(encodeSegment).join('/');
}

/** The path relative to the picture folder that `ref` encodes, or null for any other reference. */
export function decodeWorldModImageRef(ref: string): string | null {
  if (!ref.startsWith(WORLD_MOD_IMAGE_PREFIX)) return null;
  const body = ref.slice(WORLD_MOD_IMAGE_PREFIX.length);
  let out = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index);
    if (char !== '_') {
      out += char;
      continue;
    }
    const next = body.charAt(index + 1);
    if (next === '_') {
      out += '_';
      index += 1;
    } else if (next === 's') {
      out += ' ';
      index += 1;
    } else if (next === 'x') {
      const end = body.indexOf('_', index + 2);
      if (end < 0) return null;
      const code = Number.parseInt(body.slice(index + 2, end), 16);
      if (!Number.isFinite(code)) return null;
      out += String.fromCodePoint(code);
      index = end;
    } else {
      return null;
    }
  }
  return out;
}
