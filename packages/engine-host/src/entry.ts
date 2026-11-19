/**
 * The bundle's entry: installs the shims, builds the host over the inlined content packs and puts
 * it on the global object as `RingsideEngine`. The build script (`scripts/build-bundle.mjs`) turns
 * this into one script with no imports; `virtual:ringside-content` is every JSON file under the
 * repo's `content/` folder, keyed by its path inside that folder.
 */

// First, so the shims are in place before any engine module runs.
import { installedShims } from './shims';
import content from 'virtual:ringside-content';
import { createEmbeddedHost } from './host';

const host = createEmbeddedHost({ content, shims: installedShims });

Object.defineProperty(globalThis, 'RingsideEngine', {
  value: Object.freeze(host),
  writable: false,
  configurable: false,
  enumerable: true,
});
