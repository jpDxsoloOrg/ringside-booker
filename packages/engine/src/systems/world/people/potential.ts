/**
 * Starting potential: how much room a new person has to grow, per attribute, and the hidden
 * potential number next to it.
 *
 * Both come from one smooth curve over age, so a 30-year-old and a 31-year-old are never wildly
 * different prospects:
 *
 * - `expectedHeadroom(age) = H0 × clamp((Z − age) / (Z − 18), 0, 1)^k`, where `H0`
 *   (`worldgen.potential.headroomAt18`), `Z` (`worldgen.potential.headroomZeroAge`) and `k`
 *   (`worldgen.potential.curveExponent`) are tunables. It is `H0` at 18 and younger, falls
 *   smoothly, and is 0 from `Z` on.
 * - A late bloomer (chance `worldgen.potential.lateBloomerChance`, ages 25-33) counts as
 *   `worldgen.potential.lateBloomerYears` younger.
 * - Per attribute: `headroom = max(0, expected × (1 + w × talent) + variation × expected / H0)`,
 *   where `w` is `worldgen.potential.talentHeadroomWeight` and the variation is a normal draw with
 *   spread `worldgen.potential.headroomNoiseSd`, kept within 2.5 spreads. The variation fades with
 *   the expected headroom, so wherever the curve is 0 (past the zero age, or `H0 = 0`) the ceiling
 *   is exactly today's value. `ceiling = clamp(round(current + headroom), current, 100)`.
 * - `potential = round(clamp(1000 × (2 × expected / H0 − 1) + talentScale × talent, −1000, 1000))`;
 *   when `H0` is 0 the headroom term is 0.
 *
 * Ceilings cover the attributes that matter for the person's work: the in-ring and character
 * attributes for wrestlers, the role's own skills for everyone else (see {@link ceilingKeysFor}).
 * What ceilings and the potential number do over time belongs to the Workers epic; this module only
 * seeds them.
 *
 * Draws from the stream, in order: the late-bloomer roll (1, always), then one variation per
 * ceiling attribute in `ATTRIBUTE_KEYS` order (2 each).
 *
 * Design: docs/design/world-generation.md#potential.
 */

import type { GameDate } from '../../../core/date';
import { rollChance, rollNormal, type RngStream, type RollRecord } from '../../../core/rng';
import { inputOf, startCalc, traced, type TraceNode, type Traced } from '../../../core/trace';
import { tunableNode } from '../../../core/trace/tunable-node';
import {
  ATTRIBUTE_GROUPS,
  ATTRIBUTE_KEYS,
  POTENTIAL_MAX,
  POTENTIAL_MIN,
  WRESTLING_ROLES,
  type AttributeKey,
  type Development,
  type Person,
} from '../../../model/entities/person';
import type { ContentLibrary } from '../../../persistence/packs/library';
import { createEngineTunables, type EngineTunables } from '../../tunables';
import { compiledGenerationOf } from './content';
import { exactAge } from './dates';
import { ATTRIBUTE_LABELS, formatNumber } from './labels';

const POTENTIAL_DOC_REF = 'world-generation.md#potential';

/** The age the headroom curve starts from: its value at this age and younger is `H0`. */
export const HEADROOM_START_AGE = 18;

/** Youngest and oldest age (whole years) at which someone can be a late bloomer. */
export const LATE_BLOOMER_MIN_AGE = 25;
export const LATE_BLOOMER_MAX_AGE = 33;

/** The per-attribute variation is kept within this many spreads of 0. */
const NOISE_LIMIT_SPREADS = 2.5;

/** Highest attribute value, and so the highest ceiling. */
const ATTRIBUTE_MAX = 100;

/** The three numbers that shape the headroom curve. */
export interface HeadroomCurve {
  /** `H0`: expected headroom at 18 and younger, in attribute points. */
  readonly headroomAt18: number;
  /** `Z`: the age from which the expected headroom is 0. */
  readonly zeroAge: number;
  /** `k`: the curve's exponent. */
  readonly exponent: number;
}

/** The headroom curve the tunables describe. */
export function headroomCurveOf(tunables: EngineTunables): HeadroomCurve {
  return {
    headroomAt18: tunables.get('worldgen.potential.headroomAt18'),
    zeroAge: tunables.get('worldgen.potential.headroomZeroAge'),
    exponent: tunables.get('worldgen.potential.curveExponent'),
  };
}

/** The share of `H0` left at `age`: `clamp((Z − age) / (Z − 18), 0, 1)`, before the exponent. */
function shareLeft(age: number, curve: HeadroomCurve): number {
  const span = curve.zeroAge - HEADROOM_START_AGE;
  if (span <= 0) {
    return age < curve.zeroAge ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (curve.zeroAge - age) / span));
}

/**
 * Expected headroom at a fractional age: `H0 × clamp((Z − age) / (Z − 18), 0, 1)^k`. Continuous
 * and never increasing with age, `H0` at 18 and younger, 0 from `Z` on.
 */
export function expectedHeadroom(age: number, curve: HeadroomCurve): number {
  const share = shareLeft(age, curve);
  return share === 0 ? 0 : curve.headroomAt18 * share ** curve.exponent;
}

/** {@link expectedHeadroom} as a traced calculation. */
export function expectedHeadroomOf(
  age: number,
  tunables: EngineTunables,
  ageLabel = 'Age',
): Traced<number> {
  const curve = headroomCurveOf(tunables);
  const share = shareLeft(age, curve);
  const powered = share === 0 ? 0 : share ** curve.exponent;
  const shareNode: TraceNode = {
    kind: 'input',
    label: `Share of the room left at ${formatNumber(age)}`,
    value: powered,
    unit: 'ratio',
    docRef: POTENTIAL_DOC_REF,
    children: [
      inputOf(ageLabel, age, undefined, 'years').trace,
      tunableNode(tunables, 'worldgen.potential.headroomZeroAge'),
      tunableNode(tunables, 'worldgen.potential.curveExponent'),
      {
        kind: 'note',
        label: `(${formatNumber(curve.zeroAge)} − ${formatNumber(age)}) ÷ (${formatNumber(curve.zeroAge)} − ${String(HEADROOM_START_AGE)}), kept between 0 and 1, gives ${formatNumber(share)}; to the power ${formatNumber(curve.exponent)} gives ${formatNumber(powered)}`,
        value: null,
      },
    ],
  };
  const calc = startCalc('Expected room to grow', 0, {
    startLabel: 'Start',
    unit: 'points',
    docRef: POTENTIAL_DOC_REF,
  });
  return calc
    .add(
      'Room to grow at 18',
      calc.tunable(tunables, 'worldgen.potential.headroomAt18', 'Room to grow at 18'),
    )
    .multiply('Share left at this age', { value: powered, trace: shareNode })
    .done();
}

/**
 * The attributes a person gets ceilings for: the in-ring and character attributes when they
 * wrestle, plus the own skills (from the content library's role records) of every other role they
 * hold. Someone whose roles have no skills of their own (a manager) gets the character
 * attributes. Without a library, every crew attribute counts as a role skill. Always in
 * `ATTRIBUTE_KEYS` order.
 */
export function ceilingKeysFor(
  person: Pick<Person, 'roles'>,
  library?: ContentLibrary,
): readonly AttributeKey[] {
  const keys = new Set<AttributeKey>();
  const wrestles = person.roles.some((role) =>
    WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role),
  );
  if (wrestles) {
    ATTRIBUTE_GROUPS.inRing.forEach((key) => keys.add(key));
    ATTRIBUTE_GROUPS.character.forEach((key) => keys.add(key));
  }
  const roles = library === undefined ? undefined : compiledGenerationOf(library).roles;
  let skillCount = 0;
  for (const role of person.roles) {
    if (WRESTLING_ROLES.some((wrestlingRole) => wrestlingRole === role)) {
      continue;
    }
    const skills =
      roles === undefined ? ATTRIBUTE_GROUPS.crew : (roles.get(role)?.record.roleSkills ?? []);
    skills.forEach((key) => keys.add(key));
    skillCount += skills.length;
  }
  if (!wrestles && skillCount === 0) {
    ATTRIBUTE_GROUPS.character.forEach((key) => keys.add(key));
  }
  return ATTRIBUTE_KEYS.filter((key) => keys.has(key));
}

/** What {@link seedPotential} reads besides the person, talent, date and stream. */
export interface SeedPotentialOptions {
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
  /** Used to find the role skills a non-wrestler gets ceilings for. */
  readonly library?: ContentLibrary;
  /** The attributes to give ceilings to. Defaults to {@link ceilingKeysFor}. */
  readonly ceilingKeys?: readonly AttributeKey[];
}

function groupNode(
  label: string,
  value: number | string,
  children: readonly TraceNode[],
): TraceNode {
  return { kind: 'input', label, value, docRef: POTENTIAL_DOC_REF, children };
}

function rollNode(record: RollRecord): TraceNode {
  return { kind: 'roll', label: record.label, value: record.result, roll: record };
}

/**
 * Seeds `development` for `person` on `worldDate`: one ceiling per attribute in
 * `options.ceilingKeys` and the potential number, both from the same curve. Pure: the same person,
 * talent, date, tunables and stream state always give the same result. See the module comment.
 */
export function seedPotential(
  person: Person,
  talent: number,
  worldDate: GameDate,
  stream: RngStream,
  options: SeedPotentialOptions = {},
): Traced<Development> {
  const tunables = options.tunables ?? createEngineTunables();
  const keys = options.ceilingKeys ?? ceilingKeysFor(person, options.library);
  const curve = headroomCurveOf(tunables);
  const age = exactAge(person.birthDate, worldDate);
  const wholeAge = Math.floor(age);

  // Late bloomer: always one draw, so the variations below never shift.
  const bloomerChance = tunables.get('worldgen.potential.lateBloomerChance');
  const bloomerRoll = rollChance(stream, bloomerChance, 'Late bloomer');
  const inBloomerAges = wholeAge >= LATE_BLOOMER_MIN_AGE && wholeAge <= LATE_BLOOMER_MAX_AGE;
  const lateBloomer = inBloomerAges && bloomerRoll.value;
  const bloomerYears = tunables.get('worldgen.potential.lateBloomerYears');
  const curveAge = lateBloomer ? age - bloomerYears : age;
  const bloomerSteps: TraceNode[] = [
    tunableNode(tunables, 'worldgen.potential.lateBloomerChance'),
    rollNode(bloomerRoll.roll),
    {
      kind: 'branch',
      label: `Aged ${String(LATE_BLOOMER_MIN_AGE)} to ${String(LATE_BLOOMER_MAX_AGE)}`,
      value: inBloomerAges,
      condition: `Aged ${String(LATE_BLOOMER_MIN_AGE)} to ${String(LATE_BLOOMER_MAX_AGE)}`,
      taken: inBloomerAges,
    },
  ];
  if (lateBloomer) {
    bloomerSteps.push(tunableNode(tunables, 'worldgen.potential.lateBloomerYears'), {
      kind: 'note',
      label: `Late bloomer: room to grow worked out as if ${formatNumber(curveAge)}`,
      value: null,
    });
  }
  const expected = expectedHeadroomOf(
    curveAge,
    tunables,
    lateBloomer ? 'Age, counted younger for a late bloomer' : 'Age',
  );
  const fade = curve.headroomAt18 > 0 ? expected.value / curve.headroomAt18 : 0;

  // Ceilings
  const talentWeight = tunables.get('worldgen.potential.talentHeadroomWeight');
  const noiseSd = tunables.get('worldgen.potential.headroomNoiseSd');
  const noiseLimit = noiseSd * NOISE_LIMIT_SPREADS;
  const ceilings: Partial<Record<AttributeKey, number>> = {};
  const ceilingSteps: TraceNode[] = [
    tunableNode(tunables, 'worldgen.potential.talentHeadroomWeight'),
    tunableNode(tunables, 'worldgen.potential.headroomNoiseSd'),
  ];
  for (const key of ATTRIBUTE_KEYS) {
    if (!keys.includes(key)) {
      continue;
    }
    const label = ATTRIBUTE_LABELS[key];
    const current = person.attributes[key];
    const noise = rollNormal(stream, 0, noiseSd, `${label} room-to-grow variation`);
    const noiseValue = Math.min(noiseLimit, Math.max(-noiseLimit, noise.value));
    const headroom = startCalc(`${label} room to grow`, expected.value, {
      startLabel: 'Expected room to grow',
      unit: 'points',
      docRef: POTENTIAL_DOC_REF,
    })
      .multiply(
        'Talent',
        1 + talentWeight * talent,
        `1 + ${formatNumber(talentWeight)} × talent ${formatNumber(talent)}`,
      )
      .roll({ ...noise.roll, min: -noiseLimit, max: noiseLimit, result: noiseValue })
      .add(
        'Personal variation',
        noiseValue * fade,
        `Variation ${formatNumber(noiseValue)} × ${formatNumber(fade)} (fades with the expected room)`,
      )
      .max('Never negative', 0)
      .done();
    const ceiling = startCalc(`${label} ceiling`, inputOf(`${label} today`, current), {
      unit: 'points',
      docRef: POTENTIAL_DOC_REF,
    })
      .add('Room to grow', headroom)
      .round('round')
      .clamp(current, Math.max(current, ATTRIBUTE_MAX), 'Not below today, not above 100')
      .done();
    ceilings[key] = ceiling.value;
    ceilingSteps.push(ceiling.trace);
  }

  // The potential number
  const potentialCalc = startCalc('Potential', 0, {
    startLabel: 'Start',
    unit: 'points',
    docRef: POTENTIAL_DOC_REF,
  });
  if (curve.headroomAt18 > 0) {
    potentialCalc.add(
      'Room to grow',
      1000 * ((2 * expected.value) / curve.headroomAt18 - 1),
      `1000 × (2 × ${formatNumber(expected.value)} ÷ ${formatNumber(curve.headroomAt18)} − 1)`,
    );
  } else {
    potentialCalc.note('Nobody has room to grow (room at 18 is 0), so age adds nothing');
  }
  const talentScale = potentialCalc.tunable(tunables, 'worldgen.potential.talentScale');
  const potential = potentialCalc
    .add(
      'Talent',
      talentScale * talent,
      `${formatNumber(talentScale)} × talent ${formatNumber(talent)}`,
    )
    .clamp(POTENTIAL_MIN, POTENTIAL_MAX)
    .round('round')
    .done();

  const root = groupNode('Potential and ceilings', potential.value, [
    inputOf('Age', age, undefined, 'years').trace,
    inputOf('Talent', talent).trace,
    groupNode('Late bloomer', lateBloomer ? 'yes' : 'no', bloomerSteps),
    expected.trace,
    groupNode('Ceilings', `${String(Object.keys(ceilings).length)} attributes`, ceilingSteps),
    potential.trace,
  ]);
  return traced({ potential: potential.value, ceilings }, root);
}
