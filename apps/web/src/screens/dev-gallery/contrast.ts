/** WCAG 2 contrast maths for the colour token entry. */

const OPAQUE_HEX = /^#[0-9a-f]{6}$/i;

function channelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

/** True for an opaque `#rrggbb` colour, the only kind a contrast ratio is defined for here. */
export function isOpaqueHex(hex: string): boolean {
  return OPAQUE_HEX.test(hex);
}

/** WCAG 2 relative luminance of an opaque `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  if (!isOpaqueHex(hex)) throw new Error(`${hex} is not an opaque #rrggbb colour`);
  const red = channelToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const green = channelToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = channelToLinear(Number.parseInt(hex.slice(5, 7), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2 contrast ratio between two opaque colours, from 1 to 21. */
export function contrastRatio(firstHex: string, secondHex: string): number {
  const first = relativeLuminance(firstHex);
  const second = relativeLuminance(secondHex);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The WCAG AA level a ratio meets: normal text (4.5), large text and UI parts (3), or neither. */
export type ContrastLevel = 'AA' | 'AA large' | 'Below 3:1';

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 4.5) return 'AA';
  return ratio >= 3 ? 'AA large' : 'Below 3:1';
}
