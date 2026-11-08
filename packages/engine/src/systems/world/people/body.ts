/**
 * The body of a generated person: ring style, body archetype, height, weight, the condition of
 * each body part and whether they wrestle masked. Everything here draws from the body stream.
 *
 * Style and archetype are weighted picks. An archetype that cannot work a style has weight 0 for
 * it, so impossible pairs never come up and nothing is rerolled.
 *
 * Design: docs/design/world-generation.md#body.
 */

import { GenerationContentError } from '../../../core/errors';
import { rollChance, rollFloat, rollNormal, rollWeighted, type RngStream } from '../../../core/rng';
import { startCalc, startDecision, type Traced } from '../../../core/trace';
import {
  BODY_PARTS,
  HEIGHT_CM_MAX,
  HEIGHT_CM_MIN,
  WEIGHT_KG_MAX,
  WEIGHT_KG_MIN,
  type BodyCondition,
  type BodyPart,
  type Gender,
  type RingStyle,
} from '../../../model/entities/person';
import type { PromotionStyle } from '../../../model/entities/promotion-style';
import type {
  BodyArchetypeRecord,
  GenerationStyleRecord,
} from '../../../persistence/packs/records/generation';
import type { EngineTunables } from '../../tunables';
import type { CompiledGeneration } from './content';
import { BODY_PART_LABELS, formatNumber, GENDER_LABELS, STYLE_LABELS } from './labels';
import type { ArchetypeKey } from './spec';

const BODY_DOC_REF = 'world-generation.md#body';
const STYLE_DOC_REF = 'world-generation.md#ring-style';
const WEAR_DOC_REF = 'world-generation.md#body-condition';

/** Condition of a body part with no wear at all. */
const FRESH_CONDITION = 100;

/**
 * A wrestler's ring style: a weighted pick over every style's global weight, with the styles that
 * suit the home region's preferred promotion style boosted by `worldgen.people.homeStyleBoost`.
 * `nonWrestler` is never picked. Draws one number from `stream`.
 */
export function rollStyle(
  stream: RngStream,
  compiled: CompiledGeneration,
  homeStyle: PromotionStyle | null,
  tunables: EngineTunables,
): Traced<RingStyle> {
  const decision = startDecision<RingStyle>('Ring style', { docRef: STYLE_DOC_REF });
  const boost = decision.tunable(tunables, 'worldgen.people.homeStyleBoost');
  decision.note(
    homeStyle === null
      ? 'Home has no preferred style, so every style keeps its global weight'
      : `Home audiences prefer ${homeStyle} wrestling`,
  );
  const entries = compiled.wrestlingStyles.map((record) => {
    const boosted = homeStyle !== null && record.promotionStyles.includes(homeStyle);
    const weight = boosted ? record.weight * boost : record.weight;
    decision.consider(
      record.style,
      weight,
      boosted
        ? `Weight ${formatNumber(record.weight)} × ${formatNumber(boost)} (suits home)`
        : `Weight ${formatNumber(record.weight)}`,
    );
    return { item: record.style, weight };
  });
  if (!entries.some((entry) => entry.weight > 0)) {
    throw new GenerationContentError('no ring style has a weight above 0');
  }
  const picked = rollWeighted(stream, entries, 'Ring style', (style) => STYLE_LABELS[style]);
  decision.roll(picked.roll);
  return decision.choose(picked.value, 'Weighted pick');
}

/**
 * The body archetype: the given one, or a weighted pick over each archetype's weight for `style`.
 * Draws one number from `stream` when it picks.
 */
export function chooseArchetype(
  stream: RngStream,
  compiled: CompiledGeneration,
  style: RingStyle,
  given: ArchetypeKey | undefined,
): Traced<BodyArchetypeRecord> {
  const decision = startDecision<string>('Body type', { docRef: BODY_DOC_REF });
  if (given !== undefined) {
    const archetype = compiled.archetypesByKey.get(given);
    if (archetype === undefined) {
      throw new GenerationContentError(`there is no body archetype ${given}`, { archetype: given });
    }
    if (archetype.styleWeights[style] === 0) {
      decision.note(`${archetype.label} is not a usual fit for a ${STYLE_LABELS[style]}`);
    }
    const chosen = decision.choose(archetype.label, 'Set by hand');
    return { value: archetype, trace: chosen.trace };
  }
  const entries = compiled.archetypesByStyle.get(style) ?? [];
  if (entries.length === 0) {
    throw new GenerationContentError(`no body archetype suits the ${style} style`, { style });
  }
  for (const entry of entries) {
    decision.consider(entry.item.label, entry.weight, `Fit for a ${STYLE_LABELS[style]}`);
  }
  const picked = rollWeighted(stream, entries, 'Body type', (archetype) => archetype.label);
  decision.roll(picked.roll);
  const chosen = decision.choose(picked.value.label, 'Weighted pick by fit for the ring style');
  return { value: picked.value, trace: chosen.trace };
}

/** Height and weight, both whole numbers inside the person schema's ranges. */
export interface Measurements {
  readonly heightCm: Traced<number>;
  readonly weightKg: Traced<number>;
}

/**
 * Height, then weight: each uniform inside the archetype's range, scaled for women and non-binary
 * people by the archetype's scale table, rounded and clamped to the person schema's ranges. Draws
 * two numbers from `stream`.
 */
export function rollBodySize(
  stream: RngStream,
  archetype: BodyArchetypeRecord,
  gender: Gender,
): Measurements {
  const scale = gender === 'male' ? null : archetype.scale[gender];
  const heightRoll = rollFloat(stream, archetype.heightCm.min, archetype.heightCm.max, 'Height');
  const weightRoll = rollFloat(stream, archetype.weightKg.min, archetype.weightKg.max, 'Weight');
  const height = startCalc('Height (cm)', heightRoll.value, {
    startLabel: `${archetype.label} height, ${String(archetype.heightCm.min)}-${String(archetype.heightCm.max)} cm`,
    docRef: BODY_DOC_REF,
  }).roll(heightRoll.roll);
  const weight = startCalc('Weight (kg)', weightRoll.value, {
    startLabel: `${archetype.label} weight, ${String(archetype.weightKg.min)}-${String(archetype.weightKg.max)} kg`,
    docRef: BODY_DOC_REF,
  }).roll(weightRoll.roll);
  if (scale !== null) {
    const reason = `${GENDER_LABELS[gender]}'s frame`;
    height.multiply('Body scale', scale.heightCm, reason);
    weight.multiply('Body scale', scale.weightKg, reason);
  }
  return {
    heightCm: height.round('round').clamp(HEIGHT_CM_MIN, HEIGHT_CM_MAX).done(),
    weightKg: weight.round('round').clamp(WEIGHT_KG_MIN, WEIGHT_KG_MAX).done(),
  };
}

/**
 * Condition of every body part, in `BODY_PARTS` order: `100 − wear`, where wear is
 * `wearPerYear × experienceYears × style multiplier` plus a normal variation, kept between 0 and
 * `worldgen.people.wearMax`, independently per part. Draws two numbers per part from `stream`.
 */
export function rollCondition(
  stream: RngStream,
  experienceYears: number,
  style: GenerationStyleRecord,
  tunables: EngineTunables,
): { readonly condition: BodyCondition; readonly traces: readonly Traced<number>[] } {
  const entries: [BodyPart, number][] = [];
  const traces: Traced<number>[] = [];
  for (const part of BODY_PARTS) {
    const label = BODY_PART_LABELS[part];
    const wear = startCalc(`Wear on ${label.toLowerCase()}`, experienceYears, {
      startLabel: 'Years since debut',
      docRef: WEAR_DOC_REF,
    });
    wear.multiply('Wear per year', wear.tunable(tunables, 'worldgen.people.wearPerYear'));
    wear.multiply(
      'Style wear',
      style.wearMultiplier,
      `${STYLE_LABELS[style.style]} is ${style.wearMultiplier > 1 ? 'harder' : style.wearMultiplier < 1 ? 'easier' : 'average'} on the body`,
    );
    const spread = tunables.get('worldgen.people.wearSd');
    const variation = rollNormal(stream, 0, spread, `${label} wear variation`);
    wear
      .roll(variation.roll)
      .add('Personal variation', variation.value, `Spread ${formatNumber(spread)}`)
      .max('No negative wear', 0)
      .min('Most starting wear', wear.tunable(tunables, 'worldgen.people.wearMax'));
    const traced = startCalc(`${label} condition`, FRESH_CONDITION, {
      startLabel: 'Fresh',
      docRef: WEAR_DOC_REF,
    })
      .subtract('Wear', wear.done())
      .round('round')
      .clamp(0, FRESH_CONDITION)
      .done();
    entries.push([part, traced.value]);
    traces.push(traced);
  }
  const condition: BodyCondition = {
    head: FRESH_CONDITION,
    neck: FRESH_CONDITION,
    back: FRESH_CONDITION,
    arms: FRESH_CONDITION,
    torso: FRESH_CONDITION,
    legs: FRESH_CONDITION,
  };
  for (const [part, value] of entries) {
    condition[part] = value;
  }
  return { condition, traces };
}

/** Whether they wrestle masked: a chance per ring style. Draws one number from `stream`. */
export function rollIsMasked(stream: RngStream, style: GenerationStyleRecord): Traced<boolean> {
  const roll = rollChance(stream, style.maskedChance, 'Wears a mask');
  const decision = startDecision<boolean>('Masked', { docRef: BODY_DOC_REF });
  decision.roll(roll.roll);
  return decision.choose(
    roll.value,
    `${formatNumber(style.maskedChance * 100)}% of ${STYLE_LABELS[style.style]}s wear a mask`,
  );
}
