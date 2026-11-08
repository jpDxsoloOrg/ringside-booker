/**
 * Tunable definitions: the shape of every balance number in the game, and the checks that run when
 * a set of definitions is declared.
 *
 * See docs/design/tunables.md for the rules these checks enforce.
 */

/**
 * What a tunable's number means. The unit decides how the value is stored:
 *
 * - `percent` is stored as 0–100 (15 means 15%).
 * - `probability` is stored as 0–1 (0.15 means a 15% chance).
 * - `ratio` and `multiplier` are plain factors (1 means "unchanged").
 * - `money` and `money/month` are whole cents, so they are only allowed on `integer` tunables.
 * - `flag` is the unit of every `boolean` tunable and `choice` the unit of every `enum` tunable.
 */
export type TunableUnit =
  | 'points'
  | 'points/day'
  | 'percent'
  | 'ratio'
  | 'multiplier'
  | 'days'
  | 'months'
  | 'money'
  | 'money/month'
  | 'count'
  | 'probability'
  | 'flag'
  | 'choice';

/** Every unit, in the order the tunables doc lists them. */
export const TUNABLE_UNITS: readonly TunableUnit[] = [
  'points',
  'points/day',
  'percent',
  'ratio',
  'multiplier',
  'days',
  'months',
  'money',
  'money/month',
  'count',
  'probability',
  'flag',
  'choice',
];

/** Fields every tunable carries, whatever its kind. */
interface TunableDefBase {
  /** What the value measures. */
  unit: TunableUnit;
  /** Display group for the tunables editor, for example `Simulation`. */
  category: string;
  /** Plain-English description of what the number does in the game. */
  description: string;
  /** Design doc anchor that explains the formula using this tunable, for example `tunables.md#engine-tunables`. */
  docRef?: string;
}

/** A decimal number with an inclusive range. `step` is a hint for editor sliders, not a rule. */
export interface NumberTunableDef extends TunableDefBase {
  kind: 'number';
  default: number;
  min: number;
  max: number;
  step?: number;
}

/** A whole number with an inclusive range. */
export interface IntegerTunableDef extends TunableDefBase {
  kind: 'integer';
  default: number;
  min: number;
  max: number;
}

/** An on/off switch. */
export interface BooleanTunableDef extends TunableDefBase {
  kind: 'boolean';
  default: boolean;
}

/** One choice out of a fixed list of string options. */
export interface EnumTunableDef extends TunableDefBase {
  kind: 'enum';
  default: string;
  options: readonly string[];
}

/** One tunable definition. `kind` is the discriminant. */
export type TunableDef = NumberTunableDef | IntegerTunableDef | BooleanTunableDef | EnumTunableDef;

/** A set of tunable definitions keyed by tunable key. */
export type TunableDefinitions = Readonly<Record<string, TunableDef>>;

/** Every kind of tunable. */
export type TunableKind = TunableDef['kind'];

/** Any value a tunable can hold, before narrowing to a specific definition. */
export type TunableRawValue = number | boolean | string;

/**
 * The value type of one definition: `boolean` for a boolean, the literal union of its options for
 * an enum, and `number` for the number and integer kinds.
 */
export type TunableValue<Def extends TunableDef> = Def extends { kind: 'boolean' }
  ? boolean
  : Def extends { kind: 'enum'; options: readonly (infer Option)[] }
    ? Option
    : number;

/**
 * Narrows a value to one definition's value type by kind (and, for an enum, by option). Range
 * checks are not repeated here: overrides are range-checked once, when they are accepted.
 */
export function isValueOfDefinition<Def extends TunableDef>(
  def: Def,
  value: unknown,
): value is TunableValue<Def> {
  switch (def.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && def.options.includes(value);
    case 'number':
    case 'integer':
      return typeof value === 'number';
  }
}

/** Maps every key of a definition set to its value type. */
export type TunableValues<Defs extends TunableDefinitions> = {
  [Key in keyof Defs]: TunableValue<Defs[Key]>;
};

/** Thrown when a tunable definition breaks the rules. It only ever fires at module load. */
export class TunableDefinitionError extends Error {
  override readonly name = 'TunableDefinitionError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid tunable definitions:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

/**
 * Valid tunable keys: two or more dot-separated camelCase segments, each starting with a lowercase
 * letter, for example `sim.eventLogSize` or `matches.rating.topCompression`.
 */
export const TUNABLE_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

function rangeProblems(key: string, def: NumberTunableDef | IntegerTunableDef): string[] {
  const problems: string[] = [];
  const numbers: readonly (readonly [string, number])[] = [
    ['default', def.default],
    ['min', def.min],
    ['max', def.max],
  ];
  for (const [field, value] of numbers) {
    if (!Number.isFinite(value)) {
      problems.push(`${key}: ${field} must be a finite number, got ${String(value)}`);
    } else if (def.kind === 'integer' && !Number.isInteger(value)) {
      problems.push(
        `${key}: ${field} of an integer tunable must be a whole number, got ${String(value)}`,
      );
    }
  }
  if (problems.length > 0) {
    return problems;
  }
  if (def.min > def.max) {
    problems.push(`${key}: min ${String(def.min)} is greater than max ${String(def.max)}`);
  }
  if (def.default < def.min || def.default > def.max) {
    problems.push(
      `${key}: default ${String(def.default)} is outside the range ${String(def.min)} to ${String(def.max)}`,
    );
  }
  if (def.kind === 'number' && def.step !== undefined) {
    if (!Number.isFinite(def.step) || def.step <= 0) {
      problems.push(`${key}: step must be a finite number above 0, got ${String(def.step)}`);
    }
  }
  if (def.unit === 'probability' && (def.min < 0 || def.max > 1)) {
    problems.push(
      `${key}: a probability is stored as 0 to 1, so its range must stay inside 0 to 1`,
    );
  }
  return problems;
}

function unitProblems(key: string, def: TunableDef): string[] {
  const problems: string[] = [];
  if (!TUNABLE_UNITS.includes(def.unit)) {
    problems.push(`${key}: unknown unit "${def.unit}"`);
  }
  if ((def.unit === 'money' || def.unit === 'money/month') && def.kind !== 'integer') {
    problems.push(
      `${key}: money is stored as whole cents, so a ${def.unit} tunable must be an integer`,
    );
  }
  if ((def.kind === 'boolean') !== (def.unit === 'flag')) {
    problems.push(`${key}: the "flag" unit is used by boolean tunables and only by them`);
  }
  if ((def.kind === 'enum') !== (def.unit === 'choice')) {
    problems.push(`${key}: the "choice" unit is used by enum tunables and only by them`);
  }
  return problems;
}

function enumProblems(key: string, def: EnumTunableDef): string[] {
  const problems: string[] = [];
  if (def.options.length === 0) {
    problems.push(`${key}: an enum tunable needs at least one option`);
  }
  if (new Set(def.options).size !== def.options.length) {
    problems.push(`${key}: enum options must be unique`);
  }
  if (!def.options.includes(def.default)) {
    problems.push(`${key}: default "${def.default}" is not one of the options`);
  }
  return problems;
}

/** Every rule a single definition breaks, as readable sentences. Empty when the definition is valid. */
export function tunableDefinitionProblems(key: string, def: TunableDef): string[] {
  const problems: string[] = [];
  if (!TUNABLE_KEY_PATTERN.test(key)) {
    problems.push(
      `${key}: keys are dot-separated camelCase segments starting with a lowercase letter, such as "sim.eventLogSize"`,
    );
  }
  if (def.description.trim() === '') {
    problems.push(`${key}: description must not be empty`);
  }
  if (def.category.trim() === '') {
    problems.push(`${key}: category must not be empty`);
  }
  problems.push(...unitProblems(key, def));
  switch (def.kind) {
    case 'number':
    case 'integer':
      problems.push(...rangeProblems(key, def));
      break;
    case 'boolean':
      if (typeof def.default !== 'boolean') {
        problems.push(`${key}: default of a boolean tunable must be true or false`);
      }
      break;
    case 'enum':
      problems.push(...enumProblems(key, def));
      break;
  }
  return problems;
}

function freezeDefinition(def: TunableDef): TunableDef {
  if (def.kind === 'enum') {
    Object.freeze(def.options);
  }
  return Object.freeze(def);
}

/**
 * Declares a set of tunables. Checks every definition and throws a `TunableDefinitionError` listing
 * all problems, so a bad definition fails the moment its module loads. The returned object keeps
 * the literal types of the input (the `const` type parameter), which is what makes tunable keys and
 * enum options type-safe. The definitions are frozen.
 */
export function defineTunables<const Defs extends Record<string, TunableDef>>(defs: Defs): Defs {
  const problems: string[] = [];
  for (const [key, def] of Object.entries(defs)) {
    problems.push(...tunableDefinitionProblems(key, def));
  }
  if (problems.length > 0) {
    throw new TunableDefinitionError(problems);
  }
  for (const def of Object.values(defs)) {
    freezeDefinition(def);
  }
  return Object.freeze(defs);
}

type UnionToIntersection<Union> = (
  Union extends unknown ? (argument: Union) => void : never
) extends (argument: infer Intersection) => void
  ? Intersection
  : never;

type Flatten<Shape> = { [Key in keyof Shape]: Shape[Key] };

/** The combined definition type of several definition sets. */
export type MergedTunables<Sets extends readonly TunableDefinitions[]> = Flatten<
  UnionToIntersection<Sets[number]>
>;

/**
 * Merges several definition sets into one. Throws a `TunableDefinitionError` when two sets define
 * the same key, because an object spread would silently let the later set win.
 */
export function mergeTunables<const Sets extends readonly TunableDefinitions[]>(
  ...sets: Sets
): MergedTunables<Sets> {
  const merged: Record<string, TunableDef> = {};
  const duplicates: string[] = [];
  for (const set of sets) {
    for (const [key, def] of Object.entries(set)) {
      if (Object.hasOwn(merged, key)) {
        duplicates.push(`${key}: defined in more than one tunable set`);
      } else {
        merged[key] = def;
      }
    }
  }
  if (duplicates.length > 0) {
    throw new TunableDefinitionError(duplicates);
  }
  const frozen = Object.freeze(merged);
  if (!holdsEverySet(frozen, sets)) {
    throw new TunableDefinitionError(['merged tunables lost a definition']);
  }
  return frozen;
}

/** True when the merged set holds every input set's definitions under the same keys. */
function holdsEverySet<Sets extends readonly TunableDefinitions[]>(
  merged: unknown,
  sets: Sets,
): merged is MergedTunables<Sets> {
  if (typeof merged !== 'object' || merged === null) {
    return false;
  }
  return sets.every((set) =>
    Object.entries(set).every(
      ([key, def]) => Object.hasOwn(merged, key) && Reflect.get(merged, key) === def,
    ),
  );
}
