/**
 * The angle rater's random stream (MTCH5-02). `match.angle` rolls the beat formulas' noise: how a
 * person performed in a beat (`formulas/beatWorkerValue.ts`) and how the beat landed
 * (`formulas/beatScore.ts`).
 *
 * A real show draws it from the world with `ctx.rng('match.angle')`. A Match lab preview draws a
 * detached stream keyed by the preview seed ({@link anglePreviewStream}), so a preview never moves
 * a world stream (MTCH1-06, docs/design/determinism.md#detached-streams).
 */

import { detachedStream, type RngStream } from '../../../core/rng/registry';

declare module '../../../core/rng/streams' {
  interface StreamNames {
    'match.angle': true;
  }
}

/** The stream the beat formulas roll on. */
export const ANGLE_STREAM = 'match.angle';

/** The detached `match.angle` stream a preview with `previewSeed` rolls on. */
export function anglePreviewStream(worldSeed: string, previewSeed: number): RngStream {
  return detachedStream(worldSeed, ANGLE_STREAM, String(previewSeed));
}
