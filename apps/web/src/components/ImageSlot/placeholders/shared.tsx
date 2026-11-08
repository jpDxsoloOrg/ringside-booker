import type { ReactNode } from 'react';
import styles from '../ImageSlot.module.css';
import { graphemesOf } from '../initials';
import type { ImageSubject } from '../types';

/** What every placeholder generator receives. */
export interface PlaceholderProps {
  readonly subject: ImageSubject;
  /** Hidden from assistive tech when the slot sits next to the name already. */
  readonly decorative: boolean;
}

/** The eight category fills, in token order. Picked by hash; never by name. */
export const CATEGORY_FILLS: readonly (string | undefined)[] = [
  styles['cat1'],
  styles['cat2'],
  styles['cat3'],
  styles['cat4'],
  styles['cat5'],
  styles['cat6'],
  styles['cat7'],
  styles['cat8'],
];

/** Every placeholder draws in the same 64 × 64 box and scales to the slot. */
export const PLACEHOLDER_VIEW_BOX = '0 0 64 64';

interface PlaceholderSvgProps {
  readonly label: string;
  readonly decorative: boolean;
  /** Which generator drew it, for debugging and tests (`data-placeholder`). */
  readonly generator: string;
  readonly children: ReactNode;
}

/** The SVG frame: accessible name from the entity, or hidden entirely when decorative. */
export function PlaceholderSvg({ label, decorative, generator, children }: PlaceholderSvgProps) {
  if (decorative) {
    return (
      <svg
        className={styles['art']}
        viewBox={PLACEHOLDER_VIEW_BOX}
        aria-hidden="true"
        focusable="false"
        data-placeholder={generator}
      >
        {children}
      </svg>
    );
  }
  return (
    <svg
      className={styles['art']}
      viewBox={PLACEHOLDER_VIEW_BOX}
      role="img"
      aria-label={label}
      focusable="false"
      data-placeholder={generator}
    >
      {children}
    </svg>
  );
}

const NARROW_GLYPHS = /^[IJLijl1.'!|]$/u;
const WIDE_GLYPHS = /^[MWmwÆŒ@]$/u;

/** Rough width of a grapheme in em for a bold system font. Close enough to decide on squeezing. */
function estimatedGraphemeWidth(grapheme: string): number {
  if (NARROW_GLYPHS.test(grapheme)) return 0.36;
  if (WIDE_GLYPHS.test(grapheme)) return 0.95;
  const codePoint = grapheme.codePointAt(0) ?? 0;
  // Emoji, CJK and other wide scripts, and multi-code-point clusters such as flags.
  if (codePoint >= 0x2e80 || Array.from(grapheme).length > 1) return 1.05;
  return 0.74;
}

/** `textLength` and `lengthAdjust` props that squeeze text only when it would overflow. */
export type FittedTextProps =
  Record<string, never> | { textLength: number; lengthAdjust: 'spacingAndGlyphs' };

/**
 * Limits text to `maxWidth` viewBox units at `fontSize`. Text that already fits is left alone,
 * so narrow initials are never stretched; two wide glyphs ("MW") get squeezed to fit.
 */
export function fitText(text: string, fontSize: number, maxWidth: number): FittedTextProps {
  const estimate = graphemesOf(text).reduce(
    (total, grapheme) => total + estimatedGraphemeWidth(grapheme) * fontSize,
    0,
  );
  if (estimate <= maxWidth) return {};
  return { textLength: maxWidth, lengthAdjust: 'spacingAndGlyphs' };
}
