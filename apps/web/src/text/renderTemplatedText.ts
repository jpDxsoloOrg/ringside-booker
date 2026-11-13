/**
 * Templated text: the engine stores a sentence as a content key and short params
 * (`{ key: 'aip.need.depth', params: { band: 'Main event', have: 2, target: 4 } }`), never as
 * rendered words, and the web turns it into words here. Each feature registers the English for its
 * own keys under one namespace (the key's first segment) with `registerTextCatalog`, from its own
 * files, so no shared list grows with every feature.
 */

/** The params a templated text carries. */
export type TextParams = Readonly<Record<string, string | number>>;

/** The engine's `TemplatedText`: a content key and its params. */
export interface TemplatedText {
  readonly key: string;
  readonly params: TextParams;
}

/**
 * One key's English: a template with `{param}` placeholders, or a function for the few sentences
 * a placeholder cannot say (a plural, a lower-cased word).
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
 * Registers a namespace's English. Returns a function that removes it again (for tests).
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

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** Fills `{param}` placeholders; a placeholder with no param stays as written. */
export function fillTemplate(template: string, params: TextParams): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/**
 * A templated text in English. A key no catalog knows renders as the key itself, so a missing
 * string shows up on screen instead of disappearing.
 */
export function renderTemplatedText(text: TemplatedText): string {
  const template = catalogs.get(textNamespaceOf(text.key))?.[text.key];
  if (template === undefined) return text.key;
  return typeof template === 'string' ? fillTemplate(template, text.params) : template(text.params);
}
