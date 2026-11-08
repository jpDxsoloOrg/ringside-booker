/** One class name, or a falsy value that is skipped (handy for `condition && styles['x']`). */
export type ClassNamePart = string | false | null | undefined;

/** Joins the truthy class names with spaces, so a component can combine its module classes. */
export function classNames(...parts: readonly ClassNamePart[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}
