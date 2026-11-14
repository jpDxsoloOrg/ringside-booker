/**
 * The text catalogs: the English for every content key the engine stores. The engine keeps a
 * sentence as a content key and short params (`{ key: 'aip.need.depth', params: { band: 'Main
 * event', have: 2, target: 4 } }`), never as rendered words. Each feature registers the English for
 * its own keys under one namespace (the key's first segment) with `registerTextCatalog`, from its
 * own files, so no shared list grows with every feature. `renderTemplatedText.tsx` writes the words.
 */

/** The params a templated text carries. */
export type TextParams = Readonly<Record<string, string | number>>;

/** The engine's `TemplatedText`: a content key and its params. */
export interface TemplatedText {
  readonly key: string;
  readonly params: TextParams;
}

/**
 * One key's English: a template with `{param}` or `{param:format}` placeholders, or a function for
 * the few sentences a placeholder cannot say (a plural, a lower-cased word). What a function
 * returns is itself a template, so it may hand back placeholders for the renderer to fill.
 */
export type TextTemplate = string | ((params: TextParams) => string);

/** A namespace's keys and their English. Every key starts with `<namespace>.`. */
export type TextCatalog = Readonly<Record<string, TextTemplate>>;

const catalogs = new Map<string, TextCatalog>();

/** The namespace a key belongs to: its first dot-separated segment. */
export function textNamespaceOf(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

/**
 * Registers a namespace's English. Returns a function that removes it again (for tests). Keys are
 * unique by construction: every key sits under its namespace, and a namespace has one catalog.
 *
 * @throws Error when a key does not start with `<namespace>.`, or another catalog already holds
 *   the namespace (registering the same catalog object twice is allowed).
 */
export function registerTextCatalog(namespace: string, catalog: TextCatalog): () => void {
  for (const key of Object.keys(catalog)) {
    if (!key.startsWith(`${namespace}.`)) {
      throw new Error(`Text key "${key}" is outside the "${namespace}" namespace.`);
    }
  }
  const existing = catalogs.get(namespace);
  if (existing !== undefined && existing !== catalog) {
    throw new Error(`A text catalog for "${namespace}" is already registered.`);
  }
  catalogs.set(namespace, catalog);
  return () => {
    if (catalogs.get(namespace) === catalog) catalogs.delete(namespace);
  };
}

/** The English registered for `key`, or undefined when no catalog has it. */
export function textFor(key: string): TextTemplate | undefined {
  const catalog = catalogs.get(textNamespaceOf(key));
  return catalog !== undefined && Object.hasOwn(catalog, key) ? catalog[key] : undefined;
}
