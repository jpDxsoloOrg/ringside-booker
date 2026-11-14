/**
 * The built-in raters, registered at module load: `match` and the simple `angle` rater, which
 * MTCH5-03's beat rater then replaces (`{ replace: true }`), plus the finish effect modifiers
 * (MTCH2-02), which only apply to a resolved match. Imported by `systems/match/index.ts` and by
 * `rateSegment.ts`, so rating a segment always finds them.
 */

import { beatAngleRater } from '../angles/angleRater';
import { registerFinishModifiers } from '../finishes/modifiers';
import { angleRater } from './angleRater';
import { matchRater } from './matchRater';
import { restoreBuiltInRatingPolicyProvider } from './policy';
import { clearRatingRegistries, registerSegmentRater } from './registry';

function registerBuiltInRaters(): void {
  registerSegmentRater('match', matchRater);
  registerSegmentRater('angle', angleRater);
  // MTCH5-03: every promotion rates talking segments by their beats. The beat rater falls back to
  // the simple rater itself on a save without a beat catalog.
  registerSegmentRater('angle', beatAngleRater, { replace: true });
  registerFinishModifiers();
}

registerBuiltInRaters();

/**
 * Restores the match registries to the built-ins: the match and beat raters, the finish effect
 * modifiers and the built-in policy provider (the rival desk's, AIP1-07, when it is imported). Tests run in
 * one shared module graph, so a reset must leave the registries as an import left them. Tests that
 * need no provider at all also call `clearRatingPolicyProvider()`.
 */
export function resetMatchRegistriesForTests(): void {
  clearRatingRegistries();
  restoreBuiltInRatingPolicyProvider();
  registerBuiltInRaters();
}
