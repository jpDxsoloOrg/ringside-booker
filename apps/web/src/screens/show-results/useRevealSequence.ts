import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/styles/useReducedMotion';

export interface RevealSequenceOptions {
  /** How many items there are, in reveal order (a show's segment cards). */
  readonly total: number;
  /** True when the page was opened to play the reveal (`?reveal=1`). Read once, on mount. */
  readonly requested: boolean;
  /** Called once, when the sequence ends (every item and the finale are showing). */
  readonly onFinish?: () => void;
}

export interface RevealSequence {
  /** How many items are showing, from the first: `total` once everything is out. */
  readonly revealedCount: number;
  /** True once the finale (the show's score) is showing: after the last item. */
  readonly scoreRevealed: boolean;
  /** True while the reveal is running; false when it was never asked for or has ended. */
  readonly playing: boolean;
  /** True while every item is out and the next step shows the finale. */
  readonly finaleNext: boolean;
  /** Reveals the next item, or the finale after the last item. */
  readonly next: () => void;
  /** Reveals everything at once and ends the sequence. */
  readonly showAll: () => void;
}

/**
 * A tap-to-advance reveal (EVT3-10): nothing comes out on its own. Each `next` shows one more item
 * in order (on a results page, the main event last), and the step after the last item shows the
 * finale (the score). It only plays when asked for (`requested`) and when motion is welcome: with
 * reduced motion on, or without the request, everything is visible from the first render. Turning
 * reduced motion on mid-sequence shows everything at once.
 *
 * It counts steps and knows nothing of shows, so a live show night (EVT10) can drive its own
 * screen with it. The request is read on mount only, so the page can take `?reveal` out of the URL
 * when the sequence ends without the cards hiding again.
 */
export function useRevealSequence({
  total,
  requested,
  onFinish,
}: RevealSequenceOptions): RevealSequence {
  const reducedMotion = useReducedMotion();
  // Steps: 0..total items, then one more for the finale. `total + 1` means everything is out.
  const lastStep = total + 1;
  const [step, setStep] = useState(() => (requested && !reducedMotion && total > 0 ? 0 : lastStep));

  const finished = step >= lastStep || reducedMotion;
  const shownStep = finished ? lastStep : step;

  // Report the end once, whether it came from a tap, Show all or reduced motion.
  const reported = useRef(false);
  useEffect(() => {
    if (!finished || reported.current) return;
    reported.current = true;
    onFinish?.();
  }, [finished, onFinish]);

  const next = useCallback(() => {
    setStep((current) => Math.min(current + 1, lastStep));
  }, [lastStep]);

  const showAll = useCallback(() => {
    setStep(lastStep);
  }, [lastStep]);

  return {
    revealedCount: Math.min(shownStep, total),
    scoreRevealed: shownStep >= lastStep,
    playing: !finished,
    finaleNext: !finished && shownStep >= total,
    next,
    showAll,
  };
}
