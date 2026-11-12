import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/styles/useReducedMotion';

/**
 * How long each segment stays "coming up" before the next one is revealed. The fade itself is the
 * `--motion-base` token in CSS, so it is already instant under reduced motion; this is only the
 * pause between beats, long enough to read a result line.
 */
export const REVEAL_STEP_MS = 1800;

export interface RevealSequenceOptions {
  /** How many segment cards there are, in reveal order. */
  readonly total: number;
  /** True when the page was opened to play the reveal (`?reveal=1`). Read once, on mount. */
  readonly requested: boolean;
  /** Called once, when the sequence ends (every card and the score are showing). */
  readonly onFinish?: () => void;
}

export interface RevealSequence {
  /** How many cards are showing, from the first: `total` once everything is out. */
  readonly revealedCount: number;
  /** True once the show's score is showing: after the last card. */
  readonly scoreRevealed: boolean;
  /** True while the reveal is running; false when it was never asked for or has ended. */
  readonly playing: boolean;
  /** Reveals the next card now (or the score after the last card) and restarts the pause. */
  readonly next: () => void;
  /** Reveals everything at once and ends the sequence. */
  readonly showAll: () => void;
}

/**
 * The broadcast-style reveal of a results page: one card every {@link REVEAL_STEP_MS} in card
 * order, the main event last, then the score. It only plays when asked for (`requested`) and when
 * motion is welcome: with reduced motion on, or without the request, everything is visible from
 * the first render. Turning reduced motion on mid-sequence shows everything at once.
 *
 * The request is read on mount only, so the page can take `?reveal` out of the URL when the
 * sequence ends without the cards hiding again. The results already exist; this is presentation.
 */
export function useRevealSequence({
  total,
  requested,
  onFinish,
}: RevealSequenceOptions): RevealSequence {
  const reducedMotion = useReducedMotion();
  // Steps: 0..total cards, then one more for the score. `total + 1` means everything is out.
  const lastStep = total + 1;
  const [step, setStep] = useState(() => (requested && !reducedMotion && total > 0 ? 0 : lastStep));
  // Bumped by "Next segment", so the pause starts over after a manual step.
  const [timerEpoch, setTimerEpoch] = useState(0);

  const finished = step >= lastStep || reducedMotion;
  const shownStep = finished ? lastStep : step;

  useEffect(() => {
    if (finished) return undefined;
    const timer = window.setTimeout(() => {
      setStep((current) => Math.min(current + 1, lastStep));
    }, REVEAL_STEP_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [finished, lastStep, step, timerEpoch]);

  // Report the end once, whether it came from the timer, a button or reduced motion.
  const reported = useRef(false);
  useEffect(() => {
    if (!finished || reported.current) return;
    reported.current = true;
    onFinish?.();
  }, [finished, onFinish]);

  const next = useCallback(() => {
    setStep((current) => Math.min(current + 1, lastStep));
    setTimerEpoch((epoch) => epoch + 1);
  }, [lastStep]);

  const showAll = useCallback(() => {
    setStep(lastStep);
  }, [lastStep]);

  return {
    revealedCount: Math.min(shownStep, total),
    scoreRevealed: shownStep >= lastStep,
    playing: !finished,
    next,
    showAll,
  };
}
