/**
 * The built-in raters, registered at module load: `match` and the simple `angle` rater. Imported
 * by `systems/match/index.ts` and by `rateSegment.ts`, so rating a segment always finds them.
 */

import { angleRater } from './angleRater';
import { matchRater } from './matchRater';
import { clearRatingPolicyProvider } from './policy';
import { clearRatingRegistries, registerSegmentRater } from './registry';

function registerBuiltInRaters(): void {
  registerSegmentRater('match', matchRater);
  registerSegmentRater('angle', angleRater);
}

registerBuiltInRaters();

/**
 * Restores the match registries to the built-ins: the two raters, no rating modifiers and no
 * policy provider. Tests that register extras call it in `afterEach`.
 */
export function resetMatchRegistriesForTests(): void {
  clearRatingRegistries();
  clearRatingPolicyProvider();
  registerBuiltInRaters();
}
