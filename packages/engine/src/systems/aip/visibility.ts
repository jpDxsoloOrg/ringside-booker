/**
 * What a viewer may see of a promotion's private numbers, such as its cash.
 *
 * The rival desk's queries share these helpers: `visibilityOf` says how much the viewer sees,
 * `redactForViewer` turns a private number into what that viewer is shown (the exact figure, a
 * band such as "Comfortable", or nothing), and `privateInputOf` does the same for a trace input,
 * so a rival's Why? never shows a figure the player's promotion would not know. See
 * docs/design/rival-desk.md#visibility.
 */

import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import type { PromotionId } from '../../core/ids';
import { constantOf, inputOf, traced, type InputNode, type Traced } from '../../core/trace';
import type { GameWorldView } from '../../model/tables';

/**
 * How much of a promotion a viewer sees:
 *
 * - `own`: the viewer runs it;
 * - `omniscient`: the all-seeing viewer of tools and tests (`OMNISCIENT_VIEWER`);
 * - `sandbox`: the world's sandbox setting is on, so everyone sees everything;
 * - `public`: anyone else, who sees only what the promotion makes public.
 */
export type Visibility = 'own' | 'sandbox' | 'omniscient' | 'public';

/** How much of `promotionId` the viewer sees. */
export function visibilityOf(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId,
): Visibility {
  if (viewer.kind === 'omniscient') {
    return 'omniscient';
  }
  if (viewerPromotionIds(read, viewer).includes(promotionId)) {
    return 'own';
  }
  if (read.meta.settings.sandbox) {
    return 'sandbox';
  }
  return 'public';
}

/** True when the viewer may see private figures: anything but `public`. */
export function canSeePrivate(visibility: Visibility): boolean {
  return visibility !== 'public';
}

/** One display band. `min` is the lowest value in it; list bands lowest first. */
export interface Band {
  readonly label: string;
  readonly min: number;
}

/** A private number as one viewer is shown it. */
export type Redacted =
  { kind: 'exact'; value: number } | { kind: 'band'; label: string } | { kind: 'hidden' };

/** Why the cash bands are fixed and not tunables: they only label a number for the screen. */
export const CASH_DISPLAY_BANDS_REASON = "Display bands for a rival's money";

/**
 * Bands for showing a rival's money (in cents) to a viewer who may not see the figure. Display
 * labels, not balance numbers, and not AIP8's runway-based `CASH_BANDS` that rival formulas read.
 */
export const CASH_DISPLAY_BANDS: readonly Band[] = Object.freeze([
  { label: 'Struggling', min: Number.NEGATIVE_INFINITY },
  { label: 'Getting by', min: 5_000_000 },
  { label: 'Comfortable', min: 25_000_000 },
  { label: 'Wealthy', min: 100_000_000 },
  { label: 'Very wealthy', min: 500_000_000 },
]);

/** The band `value` falls in: the last band whose `min` it reaches, else the first. */
function bandOf(value: number, bands: readonly Band[]): Band | undefined {
  let found = bands[0];
  for (const band of bands) {
    if (value >= band.min) {
      found = band;
    }
  }
  return found;
}

/**
 * `value` as the viewer is shown it: exact when they may see private figures, else its band, else
 * hidden when there are no bands. Never exact for a `public` viewer.
 */
export function redactForViewer(
  visibility: Visibility,
  value: number,
  bands: readonly Band[],
): Redacted {
  if (canSeePrivate(visibility)) {
    return { kind: 'exact', value };
  }
  const band = bandOf(value, bands);
  return band === undefined ? { kind: 'hidden' } : { kind: 'band', label: band.label };
}

/**
 * A private number as a trace input for a formula a viewer may read (a rival's Why?): the number
 * itself when the viewer may see it, else the band label (with the band's lower edge as a fixed
 * constant, when it has one), else "Hidden".
 */
export function privateInputOf(
  label: string,
  value: number,
  visibility: Visibility,
  bands: readonly Band[],
): Traced<number | string> {
  const shown = redactForViewer(visibility, value, bands);
  switch (shown.kind) {
    case 'exact':
      return inputOf(label, shown.value);
    case 'hidden':
      return inputOf(label, 'Hidden');
    case 'band': {
      const band = bandOf(value, bands);
      const node: InputNode = {
        kind: 'input',
        label,
        value: shown.label,
        ...(band === undefined || !Number.isFinite(band.min)
          ? {}
          : { children: [constantOf(`${band.label} from`, band.min, bandReason(bands)).trace] }),
      };
      return traced(shown.label, node);
    }
  }
}

function bandReason(bands: readonly Band[]): string {
  return bands === CASH_DISPLAY_BANDS ? CASH_DISPLAY_BANDS_REASON : 'Display bands';
}
