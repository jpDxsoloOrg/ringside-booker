/// <reference types="vite/client" />

/** The web app's package version, injected at build time by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** `1` in the e2e build, which registers the dev-only routes in a production bundle. */
  readonly VITE_E2E?: string;
}
