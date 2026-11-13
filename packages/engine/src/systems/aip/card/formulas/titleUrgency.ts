/**
 * Title urgency: how much a title wants defending on tonight's show, in points.
 *
 * ```
 * interval = aip.titles.defenceIntervalDays × (1 + aip.titles.tempoSwing × (50 − titleFocus) ÷ 50),
 *            at least 1 day
 * overdue  = daysSinceDefence ÷ interval
 * urgency  = overdue + prestige ÷ 100 × aip.titles.prestigeWeight
 *                    + aip.titles.importanceBonus.<importance>
 * ```
 *
 * A booker who cares about titles (title focus above 50) defends them more often; a big show adds
 * a flat bonus so it puts more titles on the line. A title is due when urgency reaches
 * `aip.titles.dueThreshold` (checked by the title picture, not here).
 *
 * Design: docs/design/rival-booking.md#title-picture.
 */

import { constantOf, inputOf, startCalc, type Traced } from '../../../../core/trace';
import type { EventImportance } from '../../../../model/entities/event-definition';
import { formatNumber } from '../../../world/people/labels';
import type { EngineTunables } from '../../../tunables';
import { importanceBonusKey, TITLE_PICTURE_DOC_REF } from '../tunables';

/** The middle of the taste scale: title focus 50 keeps the usual gap as it is. */
export const NEUTRAL_TITLE_FOCUS = 50;

export interface TitleUrgencyInputs {
  /** The title's name, for the trace's title. */
  titleName: string;
  /** 0-100. */
  prestige: number;
  /** Days since the last defence (or the reign's start); 0 or more. */
  daysSinceDefence: number;
  importance: EventImportance;
  /**
   * The booker's title focus, 0-100 (`TracedTaste.values.titleFocus`). Pass the traced axis to
   * keep where it came from in the Why?.
   */
  titleFocus: number | Traced<number>;
}

/** "28 days since the last defence", "1 day since the last defence". */
export function daysSinceText(days: number): string {
  return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'} since the last defence`;
}

/** The usual gap between defences for this booker, in days. */
function intervalOf(focus: Traced<number>, tunables: EngineTunables): Traced<number> {
  const factor = startCalc('Title taste factor', 0, {
    unit: 'multiplier',
    startLabel: 'Nothing counted yet',
  });
  factor
    .add(
      'Neutral title taste',
      constantOf('Neutral title taste', NEUTRAL_TITLE_FOCUS, 'Taste 50 keeps the usual gap'),
    )
    .subtract(`Title focus ${formatNumber(focus.value)}`, focus)
    .divide(
      'Over half the taste scale',
      constantOf(
        'Half the taste scale',
        NEUTRAL_TITLE_FOCUS,
        'Taste runs from 0 to 100, so 50 either side of neutral',
      ),
    )
    .multiply('Tempo swing', factor.tunable(tunables, 'aip.titles.tempoSwing'))
    .add('On top of the usual gap', constantOf('The usual gap', 1, 'Neutral taste keeps it'));

  const interval = startCalc('Usual gap between defences', 0, {
    unit: 'days',
    startLabel: 'Nothing counted yet',
  });
  interval.add(
    'Usual gap between defences',
    interval.tunable(tunables, 'aip.titles.defenceIntervalDays'),
  );
  return interval
    .multiply(`Booker's title taste (${formatNumber(focus.value)})`, factor.done())
    .max('At least a day', constantOf('At least a day', 1, 'A title is never due twice a day'))
    .done();
}

/** The title's urgency tonight. See the module comment for the formula. */
export function titleUrgency(
  inputs: TitleUrgencyInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const focus =
    typeof inputs.titleFocus === 'number'
      ? inputOf("Booker's title focus", inputs.titleFocus, undefined, 'points')
      : inputs.titleFocus;

  const overdue = startCalc(
    'Overdue',
    inputOf(daysSinceText(inputs.daysSinceDefence), inputs.daysSinceDefence, undefined, 'days'),
    { unit: 'ratio' },
  )
    .divide('Over the usual gap between defences', intervalOf(focus, tunables))
    .done();

  const prestige = startCalc(
    'Prestige',
    inputOf(`Prestige ${formatNumber(inputs.prestige)}`, inputs.prestige, undefined, 'points'),
    { unit: 'points' },
  );
  prestige
    .divide('Per 100 prestige', constantOf('Per 100 prestige', 100, 'Prestige runs 0 to 100'))
    .multiply('Prestige weight', prestige.tunable(tunables, 'aip.titles.prestigeWeight'));

  const calc = startCalc(`Urgency of the ${inputs.titleName}`, overdue, {
    unit: 'points',
    docRef: TITLE_PICTURE_DOC_REF,
  });
  calc.add('Prestige', prestige.done());
  return calc
    .add(
      `A ${inputs.importance} show`,
      calc.tunable(tunables, importanceBonusKey(inputs.importance)),
    )
    .done();
}
