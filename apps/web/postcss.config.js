// PostCSS for the web app: custom media breakpoints.
//
// postcss-custom-media only sees @custom-media rules in the file it is processing, so
// postcss-global-data adds src/styles/breakpoints.css to every file first and removes it again
// afterwards. That lets any CSS Module write `@media (--bp-mobile) { ... }` with no import.
// The path is absolute so it works whatever directory Vite or Vitest is started from.
//
// postcss-media-minmax then lowers range syntax (`width < 48rem`) to `max-width` / `min-width`.
// Safari only reads range media queries from iOS 16.4; on older iPhones every phone rule was
// ignored and the desktop layout rendered squeezed (UI-30). It runs after custom media, so the
// breakpoints are expanded before they are lowered. Container queries keep their range syntax:
// every browser that supports container queries also supports ranges in them.

import { fileURLToPath } from 'node:url';
import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomMedia from 'postcss-custom-media';
import postcssMediaMinmax from '@csstools/postcss-media-minmax';

const breakpointsFile = fileURLToPath(new URL('./src/styles/breakpoints.css', import.meta.url));

export default {
  plugins: [
    postcssGlobalData({ files: [breakpointsFile] }),
    postcssCustomMedia(),
    postcssMediaMinmax(),
  ],
};
