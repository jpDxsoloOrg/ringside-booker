// PostCSS for the web app: custom media breakpoints.
//
// postcss-custom-media only sees @custom-media rules in the file it is processing, so
// postcss-global-data adds src/styles/breakpoints.css to every file first and removes it again
// afterwards. That lets any CSS Module write `@media (--bp-mobile) { ... }` with no import.
// The path is absolute so it works whatever directory Vite or Vitest is started from.

import { fileURLToPath } from 'node:url';
import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomMedia from 'postcss-custom-media';

const breakpointsFile = fileURLToPath(new URL('./src/styles/breakpoints.css', import.meta.url));

export default {
  plugins: [postcssGlobalData({ files: [breakpointsFile] }), postcssCustomMedia()],
};
