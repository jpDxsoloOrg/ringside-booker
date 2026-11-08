/**
 * Script mirrors of the custom media in breakpoints.css, for components whose DOM differs by
 * layout (a table that becomes cards, a sheet that opens from a different side) where CSS alone
 * cannot switch the structure. breakpoints.test.ts keeps these equal to the CSS.
 */

/** Phone layout: the one layout breakpoint. Same as `@custom-media --bp-mobile`. */
export const BP_MOBILE_QUERY = '(width < 48rem)';

/** Very wide screens, for capping widths only. Same as `@custom-media --bp-wide`. */
export const BP_WIDE_QUERY = '(width >= 90rem)';
