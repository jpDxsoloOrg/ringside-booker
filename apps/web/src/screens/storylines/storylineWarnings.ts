/**
 * The engine's warnings from `storylines.create` ("You already run 6 storylines…", "No one on the
 * other side yet."), carried in the router state to the new storyline's page, which shows them
 * once as a dismissible notice.
 */

/** The router state key the warnings travel under. */
export const STORYLINE_WARNINGS_STATE = 'storylineWarnings';

/** The warnings in a location's state, or none. */
export function storylineWarningsFrom(state: unknown): readonly string[] {
  if (typeof state !== 'object' || state === null) return [];
  const warnings: unknown = Reflect.get(state, STORYLINE_WARNINGS_STATE);
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((warning): warning is string => typeof warning === 'string');
}
