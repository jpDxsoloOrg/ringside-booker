/**
 * Show heat (EVT6-11): a card that links hot storylines sells more tickets, and a storyline's
 * finale sells more again.
 *
 * Each linked storyline adds `maxBonus` × how far its heat sits between `from` and 100 (nothing at
 * or below `from`), times `finaleFactor` when its finale is on the card. The hottest storyline adds
 * its whole bonus and every other one `otherShare` of its own, and the total never passes `cap`.
 * The heat is the heat each storyline had walking into the show (`storylineHeatsOnCard`), so the
 * booking forecast and the show-day crowd read the same number. Design:
 * docs/design/box-office.md#show-heat.
 */

import type { EntityRef } from '../../../core/trace';
import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const SHOW_HEAT_DOC_REF = 'box-office.md#show-heat';

/** One storyline linked on the card. */
export interface CardStorylineHeat {
  readonly name: string;
  /** Its heat walking into the show, 0..100. */
  readonly heat: number;
  /** True when its finale is on this card. */
  readonly finale: boolean;
  readonly ref?: EntityRef;
}

export interface ShowHeatInputs {
  /** The storylines linked on the card, each once, in any order. */
  readonly storylines: readonly CardStorylineHeat[];
}

/** "The Ashfall Feud: heat 78, finale tonight". */
export function storylineHeatLabel(storyline: CardStorylineHeat): string {
  const heat = `${storyline.name}: heat ${formatNumber(storyline.heat)}`;
  return storyline.finale ? `${heat}, finale tonight` : heat;
}

/** One storyline's bonus before the hottest-first sharing, with its own Why?. */
function storylineBonus(storyline: CardStorylineHeat, tunables: EngineTunables): Traced<number> {
  const span = startCalc(
    'Heat from where it starts to draw to 100',
    constantOf('Hottest', 100, 'Heat runs from 0 to 100'),
    { unit: 'points' },
  );
  span.subtract(
    'Heat that starts to draw',
    span.tunable(tunables, 'boxOffice.heat.from', 'Heat that starts to draw'),
  );
  const calc = startCalc(
    storylineHeatLabel(storyline),
    inputOf(`Heat of ${storyline.name}`, storyline.heat, storyline.ref, 'points'),
    { unit: 'ratio' },
  );
  calc.subtract(
    'Heat that starts to draw',
    calc.tunable(tunables, 'boxOffice.heat.from', 'Heat that starts to draw'),
  );
  calc.divide('Heat from where it starts to draw to 100', span.done());
  calc.clamp(0, 1, 'Nothing below where heat starts to draw');
  calc.multiply(
    'Crowd added at heat 100',
    calc.tunable(tunables, 'boxOffice.heat.maxBonus', 'Crowd added at heat 100'),
  );
  if (storyline.finale) {
    calc.multiply(
      'Finale tonight',
      calc.tunable(tunables, 'boxOffice.heat.finaleFactor', 'Finale tonight'),
    );
  }
  return calc.done();
}

/** The show-heat multiplier on the crowd, 1..1 + cap. Deterministic: no rolls. */
export function computeShowHeat(
  inputs: ShowHeatInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(
    'Show heat',
    constantOf('No heat', 1, 'A multiplier of 1 leaves the crowd as it is'),
    { unit: 'multiplier', docRef: SHOW_HEAT_DOC_REF },
  );
  if (inputs.storylines.length === 0) {
    calc.note('No storylines linked on the card');
    return calc.done();
  }
  const ranked = inputs.storylines
    .map((storyline) => ({ storyline, bonus: storylineBonus(storyline, tunables) }))
    .sort(
      (left, right) =>
        right.bonus.value - left.bonus.value ||
        left.storyline.name.localeCompare(right.storyline.name),
    );
  const total = startCalc(
    'Heat bonus',
    constantOf('Nothing yet', 0, 'Built up storyline by storyline'),
    {
      unit: 'ratio',
    },
  );
  ranked.forEach((entry, index) => {
    const label = storylineHeatLabel(entry.storyline);
    if (index === 0) {
      total.add(label, entry.bonus);
      return;
    }
    const shared = startCalc(label, entry.bonus, { unit: 'ratio' });
    shared.multiply(
      'Share of a second storyline',
      shared.tunable(tunables, 'boxOffice.heat.otherShare', 'Share of a second storyline'),
    );
    total.add(label, shared.done());
  });
  total.min(
    'Largest heat bonus',
    total.tunable(tunables, 'boxOffice.heat.cap', 'Largest heat bonus'),
  );
  const count = inputs.storylines.length;
  calc.add(`${String(count)} linked ${count === 1 ? 'storyline' : 'storylines'}`, total.done());
  return calc.done();
}
