/**
 * Script mirrors of the custom media in breakpoints.css, for components whose DOM differs by
 * layout (a table that becomes cards, a sheet that opens from a different side) where CSS alone
 * cannot switch the structure. breakpoints.test.ts keeps these equal to the CSS.
 *
 * Plain min-width / max-width, not range syntax: matchMedia on iOS Safari before 16.4 answers
 * false for `(width < 48rem)`, so phones there got the desktop structure (UI-30).
 */

/** Phone layout: the one layout breakpoint. Same as `@custom-media --bp-mobile`. */
export const BP_MOBILE_QUERY = '(max-width: 47.999rem)';

/** Very wide screens, for capping widths only. Same as `@custom-media --bp-wide`. */
export const BP_WIDE_QUERY = '(min-width: 90rem)';
