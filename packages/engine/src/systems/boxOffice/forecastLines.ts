/**
 * The hot streak and show heat lines of a crowd forecast in plain words (EVT6-11), for the booking
 * panel: what each adds to the crowd and why, without opening the Why?. The numbers come from the
 * forecast itself, so the words always match its Why?. Design: docs/design/box-office.md#hot-streak
 * and #show-heat.
 */

import type { EngineTunables } from '../tunables';
import { formatNumber } from '../world/people/labels';
import type { ForecastCrowdLine } from './api';
import type { AttendanceForecast } from './forecast';
import { hotStreakState, streakRunText } from './formulas/hotStreak';
import { hottestCardStoryline, storylineHeatLabel } from './formulas/showHeat';

/** "+7.5% crowd": the share a multiplier adds, to one decimal place at most. */
export function crowdAddedText(multiplier: number): string {
  const percent = Math.round((multiplier - 1) * 1000) / 10;
  return `+${formatNumber(percent)}% crowd`;
}

function hotStreakLine(forecast: AttendanceForecast, tunables: EngineTunables): ForecastCrowdLine {
  const multiplier = forecast.inputs.hotStreak.value;
  const state = hotStreakState(forecast.inputs.streakScores, tunables);
  const good = formatNumber(tunables.get('boxOffice.streak.goodScore'));
  let text: string;
  if (state.run > 0) {
    const atCap = state.bonus >= tunables.get('boxOffice.streak.cap');
    text = `${streakRunText(state.run)}: ${crowdAddedText(multiplier)}${atCap ? ', the most a streak adds' : ''}`;
  } else if (multiplier > 1) {
    const since = `${String(state.sinceBreak)} ${state.sinceBreak === 1 ? 'show' : 'shows'} ago`;
    text = `Streak broken ${since}, fading: ${crowdAddedText(multiplier)}`;
  } else {
    text = `No hot streak: a show scoring ${good} or better starts one`;
  }
  return { key: 'hotStreak', label: 'Hot streak', text, multiplier };
}

function showHeatLine(forecast: AttendanceForecast, tunables: EngineTunables): ForecastCrowdLine {
  const multiplier = forecast.inputs.showHeat.value;
  const storylines = forecast.inputs.cardStorylines;
  const hottest = hottestCardStoryline(storylines, tunables);
  let text: string;
  if (hottest === null) {
    text = 'No storylines linked on the card';
  } else if (multiplier <= 1) {
    const from = formatNumber(tunables.get('boxOffice.heat.from'));
    text = `Linked storylines are not hot enough to sell tickets yet (heat above ${from} does)`;
  } else {
    const others = storylines.length - 1;
    const more =
      others > 0 ? ` and ${String(others)} more ${others === 1 ? 'storyline' : 'storylines'}` : '';
    text = `${storylineHeatLabel(hottest)}${more}: ${crowdAddedText(multiplier)}`;
  }
  return { key: 'showHeat', label: 'Show heat', text, multiplier };
}

/** The forecast's hot streak and show heat lines, in that order. */
export function forecastCrowdLines(
  forecast: AttendanceForecast,
  tunables: EngineTunables,
): ForecastCrowdLine[] {
  return [hotStreakLine(forecast, tunables), showHeatLine(forecast, tunables)];
}
