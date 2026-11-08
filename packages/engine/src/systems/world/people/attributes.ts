/**
 * Attributes of a generated person, correlated through one hidden talent value.
 *
 * For every attribute: `value = mean + sd × (ρ × talent + √(1 − ρ²) × noise)`, where `mean`, `sd`
 * and `ρ` (the talent weight) come from the role's profile for the career stage, `talent ~ N(0, 1)`
 * is drawn once per person and `noise ~ N(0, 1)` once per attribute. Then the ring style's
 * modifiers and the body modifiers are added, a natural standout may add a large bonus to one
 * performer attribute, and the result is clamped to 0-100 and rounded.
 *
 * Because `ρ² + (1 − ρ²) = 1`, the talent term never changes an attribute's spread: it only makes
 * attributes that share talent move together. Two attributes with talent weights ρ₁ and ρ₂ have a
 * correlation of ρ₁ × ρ₂ before clamping.
 *
 * Design: docs/design/world-generation.md#attributes.
 */

import {
  rollChance,
  rollNormal,
  rollPick,
  type RngStream,
  type RollRecord,
} from '../../../core/rng';
import { inputOf, startCalc, type Calc, type Traced } from '../../../core/trace';
import { ATTRIBUTE_KEYS, type AttributeKey, type Attributes } from '../../../model/entities/person';
import type {
  BodyModifierRecord,
  GenerationProfileRecord,
  GenerationStyleRecord,
} from '../../../persistence/packs/records/generation';
import type { EngineTunables } from '../../tunables';
import { ATTRIBUTE_LABELS, formatNumber, STAGE_LABELS, STYLE_LABELS } from './labels';

const ATTRIBUTE_DOC_REF = 'world-generation.md#attributes';
const TALENT_DOC_REF = 'world-generation.md#talent';
const BODY_MODIFIER_DOC_REF = 'world-generation.md#body-modifiers';

/** Lowest and highest attribute value. */
const ATTRIBUTE_MIN = 0;
const ATTRIBUTE_MAX = 100;

/** The draws for one person's attributes, made up front in a fixed order. */
export interface AttributeDraws {
  /** The talent roll (always drawn, even when the spec sets talent). */
  readonly talentRoll: RollRecord;
  readonly talentDrawn: number;
  /** One standard normal per attribute, in `ATTRIBUTE_KEYS` order. */
  readonly noise: ReadonlyMap<AttributeKey, { readonly value: number; readonly roll: RollRecord }>;
  /** The standout roll, attribute and bonus. The attribute and bonus are drawn either way. */
  readonly standout: {
    readonly fired: boolean;
    readonly chanceRoll: RollRecord;
    readonly attribute: AttributeKey;
    readonly attributeRoll: RollRecord;
    readonly bonus: number;
    readonly bonusRoll: RollRecord;
  };
}

/**
 * Every draw the attributes need, in this order on `stream`: talent (2), one variation per
 * attribute in `ATTRIBUTE_KEYS` order (2 each), the standout chance (1), the standout attribute
 * (1) and the standout bonus (2). Every person uses the same number of draws whatever the
 * outcome, so one person's standout never shifts the next person's numbers.
 */
export function drawAttributes(
  stream: RngStream,
  standoutChance: number,
  standoutPool: readonly AttributeKey[],
  tunables: EngineTunables,
): AttributeDraws {
  const talent = rollNormal(stream, 0, 1, 'Talent');
  const noise = new Map<AttributeKey, { value: number; roll: RollRecord }>();
  for (const key of ATTRIBUTE_KEYS) {
    const roll = rollNormal(stream, 0, 1, `${ATTRIBUTE_LABELS[key]} variation`);
    noise.set(key, { value: roll.value, roll: roll.roll });
  }
  const chance = rollChance(stream, standoutChance, 'Natural standout');
  const attribute = rollPick(
    stream,
    standoutPool,
    'Standout attribute',
    (key) => ATTRIBUTE_LABELS[key],
  );
  const bonusMin = tunables.get('worldgen.people.standoutBonusMin');
  const bonusMax = Math.max(bonusMin, tunables.get('worldgen.people.standoutBonusMax'));
  const bonusRoll = rollNormal(
    stream,
    tunables.get('worldgen.people.standoutBonusMean'),
    tunables.get('worldgen.people.standoutBonusSd'),
    'Standout bonus',
  );
  const bonus = Math.min(bonusMax, Math.max(bonusMin, bonusRoll.value));
  return {
    talentRoll: talent.roll,
    talentDrawn: talent.value,
    noise,
    standout: {
      fired: chance.value,
      chanceRoll: chance.roll,
      attribute: attribute.value,
      attributeRoll: attribute.roll,
      bonus,
      bonusRoll: { ...bonusRoll.roll, min: bonusMin, max: bonusMax, result: bonus },
    },
  };
}

/** The talent the attributes use: the drawn z-score, or the spec's override. */
export function talentOf(draws: AttributeDraws, override: number | undefined): Traced<number> {
  const calc = startCalc('Talent', 0, {
    startLabel: 'Average talent',
    docRef: TALENT_DOC_REF,
  });
  calc.roll(draws.talentRoll);
  if (override === undefined) {
    return calc.add('Drawn talent', draws.talentDrawn, 'Standard deviations from average').done();
  }
  return calc
    .note(`Drawn ${formatNumber(draws.talentDrawn)}, replaced by a hand-picked value`)
    .add('Set by hand', override, 'Standard deviations from average')
    .done();
}

/**
 * The effect of one body modifier: `perUnit` points per centimetre or kilogram past `from`, kept
 * within `±limit`. Zero when the measure is not past the threshold.
 */
export function bodyModifierEffect(
  modifier: BodyModifierRecord,
  heightCm: number,
  weightKg: number,
): Traced<number> | null {
  const measure = modifier.measure === 'heightCm' ? heightCm : weightKg;
  const distance =
    modifier.direction === 'above'
      ? Math.max(0, measure - modifier.from)
      : Math.max(0, modifier.from - measure);
  if (distance === 0) {
    return null;
  }
  const unit = modifier.measure === 'heightCm' ? 'cm' : 'kg';
  return startCalc(modifier.label, distance, {
    startLabel: `${unit} ${modifier.direction} ${formatNumber(modifier.from)} ${unit}`,
    docRef: BODY_MODIFIER_DOC_REF,
  })
    .multiply(`Points per ${unit}`, modifier.perUnit)
    .clamp(-modifier.limit, modifier.limit, `At most ${formatNumber(modifier.limit)} points`)
    .done();
}

/** What one attribute is built from. */
export interface AttributeInputs {
  readonly profile: GenerationProfileRecord;
  readonly style: GenerationStyleRecord;
  readonly bodyModifiers: readonly BodyModifierRecord[];
  readonly heightCm: number;
  readonly weightKg: number;
  readonly talent: number;
  readonly draws: AttributeDraws;
  readonly overrides: Partial<Record<AttributeKey, number>>;
}

function finish(calc: Calc): Traced<number> {
  return calc.clamp(ATTRIBUTE_MIN, ATTRIBUTE_MAX).round('round').done();
}

/** One attribute, traced: profile mean, talent term, variation, modifiers, standout, clamp, round. */
export function buildAttribute(key: AttributeKey, inputs: AttributeInputs): Traced<number> {
  const label = ATTRIBUTE_LABELS[key];
  const override = inputs.overrides[key];
  const distribution = inputs.profile.attributes[key];
  const { mean, sd, talentWeight } = distribution;
  const noise = inputs.draws.noise.get(key);
  const noiseValue = noise?.value ?? 0;

  const calc = startCalc(label, mean, {
    startLabel: `${STAGE_LABELS[inputs.profile.stage]} average (${inputs.profile.label})`,
    docRef: ATTRIBUTE_DOC_REF,
  });
  calc.add(
    'Talent',
    sd * talentWeight * inputs.talent,
    `Talent ${formatNumber(inputs.talent)} × weight ${formatNumber(talentWeight)} × spread ${formatNumber(sd)}`,
  );
  if (noise !== undefined) {
    calc.roll(noise.roll);
  }
  const independentShare = Math.sqrt(1 - talentWeight * talentWeight);
  calc.add(
    'Personal variation',
    sd * independentShare * noiseValue,
    `Variation ${formatNumber(noiseValue)} × ${formatNumber(independentShare)} (the part talent does not explain) × spread ${formatNumber(sd)}`,
  );
  const styleModifier = inputs.style.attributeModifiers[key];
  if (styleModifier !== undefined && styleModifier !== 0) {
    calc.add(`${STYLE_LABELS[inputs.style.style]} style`, styleModifier);
  }
  for (const modifier of inputs.bodyModifiers) {
    if (modifier.attribute !== key) {
      continue;
    }
    const effect = bodyModifierEffect(modifier, inputs.heightCm, inputs.weightKg);
    if (effect !== null) {
      calc.add('Body', effect, modifier.label);
    }
  }
  const standout = inputs.draws.standout;
  if (standout.fired && standout.attribute === key) {
    calc
      .roll(standout.chanceRoll)
      .roll(standout.attributeRoll)
      .roll(standout.bonusRoll)
      .add('Natural standout', standout.bonus);
  }
  const rolled = finish(calc);
  if (override === undefined) {
    return rolled;
  }
  return finish(
    startCalc(label, inputOf('Set by hand', override, undefined, 'points'), {
      docRef: ATTRIBUTE_DOC_REF,
    }).note(`Rolled ${formatNumber(rolled.value)} before it was set by hand`),
  );
}

/** Every attribute, in `ATTRIBUTE_KEYS` order, with one trace per attribute. */
export function buildAttributes(inputs: AttributeInputs): {
  readonly attributes: Attributes;
  readonly traces: readonly Traced<number>[];
} {
  const traces = ATTRIBUTE_KEYS.map((key) => buildAttribute(key, inputs));
  const attributes: Attributes = {
    ringwork: 0,
    psychology: 0,
    stamina: 0,
    safety: 0,
    athleticism: 0,
    mic: 0,
    charisma: 0,
    presence: 0,
    officiating: 0,
    broadcasting: 0,
    producing: 0,
    booking: 0,
  };
  ATTRIBUTE_KEYS.forEach((key, index) => {
    attributes[key] = traces[index]?.value ?? 0;
  });
  return { attributes, traces };
}
