/**
 * Card score: how strong a planned segment is, in points, so the planner can put the strongest last.
 *
 * ```
 * base     = mean(participants' card values)
 * talking  = base × aip.card.order.talkFactor           (talking segments only)
 * titles   = Σ prestige × aip.card.order.titleWeight    (one line per title on the line)
 * heat     = max heat × aip.card.order.heatWeight       (the hottest storyline only)
 * featured = aip.card.order.aceBoost with the ace in it, else aip.card.order.prospectBoost with a
 *            prospect in it, else 0
 * score    = base (× talk factor) + titles + heat + featured
 * ```
 *
 * The score is a ranking, not a 0-100 stat, so it is never clamped: a title match between two stars
 * may score above 100. A segment with nobody in it scores 0.
 *
 * Design: docs/design/rival-booking.md#card-score.
 */

import { inputOf, startCalc, type Traced } from '../../../../core/trace';
import type { SegmentDraft } from '../../../booking/draft';
import type { EngineTunables } from '../../../tunables';
import { formatNumber } from '../../../world/people/labels';
import { CARD_SCORE_DOC_REF } from '../tunables';

export type FeaturedKind = 'ace' | 'prospect';

export interface CardScoreInputs {
  /** The matchup ("Haruto Ise vs Daichi Kuroe"), for the trace's title. */
  readonly label: string;
  readonly kind: SegmentDraft['kind'];
  /** Everyone in the segment, once each, with their card value at the show's promotion. */
  readonly participantCardValues: readonly { readonly name: string; readonly value: number }[];
  /** Titles on the line. */
  readonly titles: readonly { readonly name: string; readonly prestige: number }[];
  /** Storylines the segment belongs to. */
  readonly storylines: readonly { readonly name: string; readonly heat: number }[];
  /** The promotion's featured workers in the segment (AIP3). */
  readonly featured: readonly { readonly name: string; readonly kind: FeaturedKind }[];
  /** False while the rival desk has named no ace or prospects yet (before AIP3's first review). */
  readonly featuredNamed?: boolean;
}

export const NOBODY_IN_IT_NOTE = 'Nobody in it yet: it scores 0';
export const NO_FEATURED_NOTE = 'No ace or prospects named yet';

/** "Card score: Haruto Ise vs Daichi Kuroe". */
export function cardScoreLabel(label: string): string {
  return `Card score: ${label}`;
}

/** "Storyline 'Ise vs Kuroe' heat 64". */
export function storylineHeatText(name: string, heat: number): string {
  return `Storyline '${name}' heat ${formatNumber(heat)}`;
}

/** "Ace Haruto Ise" or "Prospect Daichi Kuroe". */
export function featuredText(kind: FeaturedKind, name: string): string {
  return `${kind === 'ace' ? 'Ace' : 'Prospect'} ${name}`;
}

/** The segment's card score. See the module comment for the formula. */
export function cardScore(
  inputs: CardScoreInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(cardScoreLabel(inputs.label), 0, {
    unit: 'points',
    docRef: CARD_SCORE_DOC_REF,
    startLabel: 'Nothing counted yet',
  });

  const people = inputs.participantCardValues;
  if (people.length === 0) {
    calc.note(NOBODY_IN_IT_NOTE);
  } else {
    for (const person of people) {
      calc.add(
        person.name,
        inputOf(`Card value of ${person.name}`, person.value, undefined, 'points'),
      );
    }
    calc.divide(
      people.length === 1 ? 'One person' : `Mean of ${String(people.length)} people`,
      inputOf('People in it', people.length, undefined, 'count'),
    );
  }

  if (inputs.kind === 'angle') {
    calc.multiply(
      'A talking segment',
      calc.tunable(tunables, 'aip.card.order.talkFactor'),
      'Talking segments rank below matches of the same people',
    );
  }

  if (inputs.titles.length > 0) {
    for (const title of inputs.titles) {
      const points = startCalc(`${title.name} on the line`, 0, {
        unit: 'points',
        startLabel: 'Nothing counted yet',
      });
      points
        .add(
          'Prestige',
          inputOf(`Prestige of the ${title.name}`, title.prestige, undefined, 'points'),
        )
        .multiply(
          'Points per prestige point',
          points.tunable(tunables, 'aip.card.order.titleWeight'),
        );
      calc.add(`The ${title.name} is on the line`, points.done());
    }
  }

  const hottest = [...inputs.storylines].sort(
    (left, right) => right.heat - left.heat || (left.name < right.name ? -1 : 1),
  )[0];
  if (hottest !== undefined) {
    const points = startCalc(`Heat of '${hottest.name}'`, 0, {
      unit: 'points',
      startLabel: 'Nothing counted yet',
    });
    points
      .add('Heat', inputOf('Storyline heat', hottest.heat, undefined, 'points'))
      .multiply('Points per heat point', points.tunable(tunables, 'aip.card.order.heatWeight'));
    calc.add(storylineHeatText(hottest.name, hottest.heat), points.done());
  }

  const ace = inputs.featured.find((entry) => entry.kind === 'ace');
  const prospect = inputs.featured.find((entry) => entry.kind === 'prospect');
  const aceBoost = tunables.get('aip.card.order.aceBoost');
  const prospectBoost = tunables.get('aip.card.order.prospectBoost');
  // The larger boost counts, never both; the ace wins a tie.
  const star =
    ace !== undefined && (prospect === undefined || aceBoost >= prospectBoost) ? ace : prospect;
  if (inputs.featuredNamed === false) {
    calc.note(NO_FEATURED_NOTE);
  } else if (star !== undefined) {
    calc.add(
      featuredText(star.kind, star.name),
      calc.tunable(
        tunables,
        star.kind === 'ace' ? 'aip.card.order.aceBoost' : 'aip.card.order.prospectBoost',
      ),
      ace !== undefined && prospect !== undefined
        ? 'Only the larger featured boost counts'
        : undefined,
    );
  }
  return calc.done();
}
