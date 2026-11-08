/// <reference types="vite/client" />

/** The web app's package version, injected at build time by `define` in vite.config.ts. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Set to '1' for end-to-end runs against a production build, to keep dev-only routes. */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
