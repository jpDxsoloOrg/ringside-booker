/**
 * The words of the lab's Result group and simulated result (MTCH2-04), kept apart from the
 * components so they can be tested on their own. Sides are stored 0-based and shown from 1.
 */
import type { FinishCategory, FinishOption, PlannedWinner, SimulateResult } from '@ringside/engine';
import { finishEffectLabel } from '@ringside/engine';
import { sideLabel } from '../labText';

/** The Finish select's Auto option. */
export const AUTO_FINISH_LABEL = 'Auto (decided on the night)';

/** Said when a booked finish no longer fits the match. */
export const FINISH_RESET_MESSAGE = 'Finish reset to Auto: not allowed for this match';

/** The Winner choice's Auto option in a Random winners game, and its description. */
export const RANDOM_WINNERS_AUTO_LABEL = 'Auto (Random winners)';
export const RANDOM_WINNERS_AUTO_DESCRIPTION = 'Who wins is decided on the night';

/** The Select value of the Auto finish (a Select value can't be empty). */
export const AUTO_FINISH_VALUE = 'auto';

/** Each finish category as a badge says it. */
export const FINISH_CATEGORY_LABELS: Readonly<Record<FinishCategory, string>> = {
  clean: 'Clean',
  cheating: 'Cheating',
  countOut: 'Count-out',
  disqualification: 'Disqualification',
  controversial: 'Controversial',
  draw: 'Draw',
  noContest: 'No contest',
};

/** The winner choice as a radio value: `auto`, `draw` or `side-1` for the 0-based side 1. */
export function winnerValue(winner: PlannedWinner): string {
  return typeof winner === 'object' ? `side-${String(winner.side)}` : winner;
}

/** A radio value back to the winner choice, or null for a value that is none of them. */
export function winnerFromValue(value: string): PlannedWinner | null {
  if (value === 'auto' || value === 'draw') return value;
  const match = /^side-(\d+)$/.exec(value);
  return match === null ? null : { side: Number(match[1]) };
}

/** "Alpha & Beta". */
export function namesText(names: readonly string[]): string {
  return names.join(' & ');
}

/** "Side 2: Alpha & Beta", or just "Side 2" for an empty side. */
export function sideOptionLabel(side: number, names: readonly string[]): string {
  return names.length === 0 ? sideLabel(side) : `${sideLabel(side)}: ${namesText(names)}`;
}

/** A finish as the select lists it: its name, with " (no title change)" when titles stay put. */
export function finishOptionLabel(
  finish: Pick<FinishOption, 'name' | 'allowsTitleChange'>,
): string {
  return finish.allowsTitleChange ? finish.name : `${finish.name} (no title change)`;
}

/** "Side 2 wins: Alpha & Beta", "Draw" or "No contest". */
export function outcomeHeadline(
  simulation: Pick<SimulateResult, 'outcome' | 'winnerNames'>,
): string {
  const { outcome, winnerNames } = simulation;
  if (outcome.kind === 'draw') return 'Draw';
  if (outcome.kind === 'noContest') return 'No contest';
  const wins = `${sideLabel(outcome.winningSide)} wins`;
  return winnerNames.length === 0 ? wins : `${wins}: ${namesText(winnerNames)}`;
}

/**
 * "Pinfall · Clean finish"; "Double count-out finish" when nobody won, and "Disqualification
 * finish" when the method is the finish's own name.
 */
export function methodLineText(simulation: Pick<SimulateResult, 'method' | 'finish'>): string {
  const { method } = simulation;
  const finish = finishEffectLabel(simulation.finish.name);
  return method === null || method.name.toLowerCase() === simulation.finish.name.toLowerCase()
    ? finish
    : `${method.name} · ${finish}`;
}

/** "Titles can't change hands on a Disqualification finish". */
export function noTitleChangeText(finishName: string): string {
  return `Titles can't change hands on a ${finishEffectLabel(finishName)}`;
}
