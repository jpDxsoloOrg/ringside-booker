/** Every JSON file under `content/`, keyed by its path inside that folder (see build-bundle.mjs). */
declare module 'virtual:ringside-content' {
  const files: Readonly<Record<string, unknown>>;
  export default files;
}
