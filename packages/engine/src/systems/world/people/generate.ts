/**
 * The people generator: a plausible new person from a short spec.
 *
 * `generatePerson(spec, ctx)` decides where someone is from, their gender, age, birth and debut
 * dates, ring style, body, condition and every core attribute, from the generation records of the
 * content library (`content/base/generation/` in the shipped game) and a few tunables. It is a
 * pure function of the spec, the world date, the content library and the RNG state, apart from
 * the name it adds to the name generator's registry. The same function feeds the default roster,
 * ongoing newcomers and training schools.
 *
 * Draw order (fixed, so a seed always gives the same people):
 * - `worldgen.people.identity`: home region (only when no region is given), gender (only when not
 *   given), career stage (only when not given), age (2 draws), birthday offset (1), debut age
 *   (2, roles with a debut only), motivation (1).
 * - `worldgen.people.body`: ring style (wrestling roles without a given style), body archetype
 *   (only when not given), height (1), weight (1), wear for each body part in `BODY_PARTS` order
 *   (2 each), mask (1).
 * - `worldgen.people.attributes`: talent (2, drawn even when the spec sets it), variation for each
 *   attribute in `ATTRIBUTE_KEYS` order (2 each), standout chance (1), standout attribute (1),
 *   standout bonus (2). Always 30 draws, so attributes never shift with anything else.
 * - `worldgen.names.person`: the legal name (see the name generator).
 *
 * After the core person is built, the seeds (potential, traits, vices, popularity; WLD-07) run in
 * that order on streams of their own: `worldgen.people.potential`, `.traits`, `.vices` and
 * `.popularity`. The context's `hooks` replace them; without `hooks` the defaults from `seeds.ts`
 * run, and `hooks: {}` turns them all off.
 *
 * Design: docs/design/world-generation.md#generating-people.
 */

import './streams';
import { GenerationContentError, InvalidGeneratedPersonError } from '../../../core/errors';
import { formatPath } from '../../../core/json';
import { rollWeighted, type RngStream, type RollRecord } from '../../../core/rng';
import { startDecision, traced, type TraceNode, type Traced } from '../../../core/trace';
import {
  PersonSchema,
  RING_NAME_MAX_LENGTH,
  type Gender,
  type Person,
  type RingStyle,
} from '../../../model/entities/person';
import type { Region } from '../../../model/entities/geography';
import type { WorldView } from '../../../model/world';
import type { ContentLibrary } from '../../../persistence/packs/library';
import type { CareerStage } from '../../../persistence/packs/records/generation';
import { createEngineTunables, type EngineTunables } from '../../tunables';
import { geographyOf, pickRegion, regionWeight, type Geography } from '../geography';
import { NameGenerator } from '../names/generator';
import { buildAttributes, drawAttributes, talentOf } from './attributes';
import { chooseArchetype, rollCondition, rollIsMasked, rollBodySize, rollStyle } from './body';
import { compiledGenerationOf, profileOf, roleOf, styleOf, type CompiledRole } from './content';
import { rollAge, rollBirthDate, rollDebut } from './dates';
import { DEFAULT_SEED_HOOKS } from './seeds';
import { formatNumber, GENDER_LABELS, ROLE_LABELS, STAGE_LABELS, STYLE_LABELS } from './labels';
import type {
  GenerateContext,
  GenerateSpec,
  GeneratedPerson,
  PersonSeedHook,
  PersonSeedHooks,
  StreamSource,
} from './spec';

const PEOPLE_DOC_REF = 'world-generation.md#generating-people';
const LOCATION_DOC_REF = 'world-generation.md#location';

/** The seeds, in the order they run, with the words their trace uses. */
const SEED_ORDER: readonly (readonly [keyof PersonSeedHooks, string])[] = [
  ['seedPotential', 'potential'],
  ['seedTraits', 'traits'],
  ['seedVices', 'vices'],
  ['seedPopularity', 'popularity'],
];

/** A list of trace steps grouped under one labelled node. */
function group(label: string, value: string, children: readonly TraceNode[]): TraceNode {
  return { kind: 'input', label, value, docRef: PEOPLE_DOC_REF, children };
}

function rollNode(record: RollRecord): TraceNode {
  return { kind: 'roll', label: record.label, value: record.result, roll: record };
}

// ---------------------------------------------------------------------------------------------
// Identity

/** The regions a person may come from, given the spec's location fields. */
function candidateRegions(geography: Geography, spec: GenerateSpec): readonly Region[] {
  if (spec.countryId !== undefined) {
    geography.country(spec.countryId);
    return geography.regionsOf(spec.countryId);
  }
  if (spec.continentId !== undefined) {
    geography.continent(spec.continentId);
    return geography
      .countriesOf(spec.continentId)
      .flatMap((country) => geography.regionsOf(country.id));
  }
  return geography.regions;
}

/** Where they are from: the given region, or a pick weighted by population × interest. */
function chooseHome(stream: RngStream, geography: Geography, spec: GenerateSpec): Traced<Region> {
  const decision = startDecision<string>('Home region', { docRef: LOCATION_DOC_REF });
  if (spec.regionId !== undefined) {
    const region = geography.region(spec.regionId);
    const chosen = decision.choose(region.name, 'Set by hand');
    return { value: region, trace: chosen.trace };
  }
  const candidates = candidateRegions(geography, spec);
  if (candidates.length === 0) {
    throw new GenerationContentError('there are no regions to pick a home from');
  }
  const scope =
    spec.countryId !== undefined
      ? `in ${geography.country(spec.countryId).name}`
      : spec.continentId !== undefined
        ? `in ${geography.continent(spec.continentId).name}`
        : 'anywhere on the map';
  const total = candidates.reduce((sum, region) => sum + regionWeight(region), 0);
  const region = pickRegion(stream, candidates, regionWeight);
  decision.note(`Picked ${scope}, weighted by population × wrestling interest`);
  decision.roll({
    stream: stream.name,
    kind: 'weighted',
    label: 'Home region',
    ...(total > 0 ? { odds: regionWeight(region) / total } : {}),
    options: candidates.length,
    result: region.name,
  });
  const chosen = decision.choose(region.name, 'Weighted pick');
  return { value: region, trace: chosen.trace };
}

/** A weighted pick between options, or the spec's value when it sets one. */
function chooseOption<Option extends string>(
  stream: RngStream,
  label: string,
  given: Option | undefined,
  entries: readonly { readonly item: Option; readonly weight: number }[],
  describe: (option: Option) => string,
  docRef: string,
): Traced<Option> {
  const decision = startDecision<Option>(label, { docRef });
  if (given !== undefined) {
    return decision.choose(given, 'Set by hand');
  }
  for (const entry of entries) {
    decision.consider(entry.item, entry.weight, `Share ${formatNumber(entry.weight)}`);
  }
  const picked = rollWeighted(stream, entries, label, describe);
  decision.roll(picked.roll);
  return decision.choose(picked.value, 'Weighted pick');
}

// ---------------------------------------------------------------------------------------------
// Checks on the spec

function checkStyle(role: CompiledRole, given: RingStyle | undefined): void {
  if (given === undefined) {
    return;
  }
  if (role.record.performer && given === 'nonWrestler') {
    throw new GenerationContentError(`a ${role.record.role} needs a ring style, not nonWrestler`, {
      role: role.record.role,
    });
  }
  if (!role.record.performer && given !== 'nonWrestler') {
    throw new GenerationContentError(
      `a ${role.record.role} does not wrestle, so the style must be nonWrestler (got ${given})`,
      { role: role.record.role, style: given },
    );
  }
}

/** The default ring name: the legal name, cut to the ring name length when it is longer. */
function defaultRingNameFor(display: string): string {
  return display.length <= RING_NAME_MAX_LENGTH
    ? display
    : display.slice(0, RING_NAME_MAX_LENGTH).trimEnd();
}

function runSeeds(
  person: Person,
  hooks: PersonSeedHooks,
  seedInput: Omit<Parameters<PersonSeedHook>[0], 'person'>,
): { readonly person: Person; readonly trace: TraceNode } {
  let current = person;
  const steps: TraceNode[] = [];
  for (const [name, words] of SEED_ORDER) {
    const hook = hooks[name];
    if (hook === undefined) {
      steps.push({ kind: 'note', label: `No ${words} seeding registered`, value: null });
      continue;
    }
    const seeded = hook({ ...seedInput, person: current });
    current = seeded.value;
    steps.push(seeded.trace);
  }
  return {
    person: current,
    trace: group('Seeding', 'potential, traits, vices, popularity', steps),
  };
}

function assertValidPerson(person: Person): void {
  const parsed = PersonSchema.safeParse(person);
  if (!parsed.success) {
    throw new InvalidGeneratedPersonError(
      parsed.error.issues.map((issue) => `${formatPath('person', issue.path)}: ${issue.message}`),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// The generator

/**
 * Generates one person. See the module comment for the draw order.
 *
 * @throws GenerationContentError when the library lacks the role, profile, style or archetype the
 *   spec needs, or the spec contradicts the role.
 * @throws InvalidGeneratedPersonError when validation is on and the result does not parse.
 */
export function generatePerson(spec: GenerateSpec, ctx: GenerateContext): Traced<GeneratedPerson> {
  const tunables = ctx.tunables ?? createEngineTunables();
  const compiled = compiledGenerationOf(ctx.library);
  const role = roleOf(compiled, spec.role);
  checkStyle(role, spec.style);
  const identityStream = ctx.rng('worldgen.people.identity');
  const bodyStream = ctx.rng('worldgen.people.body');
  const attributeStream = ctx.rng('worldgen.people.attributes');

  // Identity
  const home = chooseHome(identityStream, ctx.geography, spec);
  const country = ctx.geography.country(home.value.countryId);
  const gender = chooseOption<Gender>(
    identityStream,
    'Gender',
    spec.gender,
    role.genders,
    (option) => GENDER_LABELS[option],
    PEOPLE_DOC_REF,
  );
  const stage = chooseOption<CareerStage>(
    identityStream,
    'Career stage',
    spec.careerStage,
    role.stages,
    (option) => STAGE_LABELS[option],
    PEOPLE_DOC_REF,
  );
  const profile = profileOf(role, stage.value);
  const age = rollAge(identityStream, stage.value, role.record.stageAges[stage.value]);
  const birth = rollBirthDate(identityStream, ctx.worldDate, age.value);
  const debut =
    role.record.debut === null
      ? null
      : rollDebut(
          identityStream,
          role.record.debut,
          tunables,
          age.value,
          birth.value,
          ctx.worldDate,
        );
  const motivation = chooseOption(
    identityStream,
    'Motivation',
    undefined,
    role.motivations,
    (option) => option,
    PEOPLE_DOC_REF,
  );
  const name = ctx.names.personName(ctx.rng('worldgen.names.person'), {
    countryId: country.id,
    gender: gender.value,
    personId: ctx.personId,
  });

  // Body
  const homeStyle = home.value.preferredStyle ?? country.preferredStyle;
  const style: Traced<RingStyle> = role.record.performer
    ? spec.style === undefined
      ? rollStyle(bodyStream, compiled, homeStyle, tunables)
      : startDecision<RingStyle>('Ring style').choose(spec.style, 'Set by hand')
    : startDecision<RingStyle>('Ring style').choose('nonWrestler', 'Does not wrestle');
  const styleRecord = styleOf(compiled, style.value);
  const archetype = chooseArchetype(bodyStream, compiled, style.value, spec.archetype);
  const measurements = rollBodySize(bodyStream, archetype.value, gender.value);
  const experienceYears = debut?.value.experienceYears ?? 0;
  const condition = rollCondition(bodyStream, experienceYears, styleRecord, tunables);
  const masked = rollIsMasked(bodyStream, styleRecord);

  // Attributes
  const draws = drawAttributes(
    attributeStream,
    role.record.performer ? tunables.get('worldgen.people.standoutChance') : 0,
    role.record.performerAttributes,
    tunables,
  );
  const talent = talentOf(draws, spec.talent);
  const attributes = buildAttributes({
    profile,
    style: styleRecord,
    bodyModifiers: compiled.bodyModifiers,
    heightCm: measurements.heightCm.value,
    weightKg: measurements.weightKg.value,
    talent: talent.value,
    draws,
    overrides: spec.attributeOverrides ?? {},
  });
  const canBookFrom = tunables.get('worldgen.people.canBookFrom');

  const core: Person = {
    id: ctx.personId,
    givenName: name.value.givenName,
    familyName: name.value.familyName,
    defaultRingName: defaultRingNameFor(name.value.display),
    gender: gender.value,
    birthDate: birth.value,
    debutDate: debut?.value.debutDate ?? null,
    birthRegionId: home.value.id,
    basedInRegionId: home.value.id,
    imageRef: null,
    masked: masked.value,
    tags: ['generated'],
    roles: [spec.role],
    status: 'active',
    career: { canOwn: false, canBook: attributes.attributes.booking >= canBookFrom },
    motivation: motivation.value,
    heightCm: measurements.heightCm.value,
    weightKg: measurements.weightKg.value,
    build: archetype.value.build,
    style: style.value,
    attributes: attributes.attributes,
    condition: condition.condition,
    fatigue: 0,
    injury: null,
    restrictions: [],
    development: { potential: 0, ceilings: {} },
    regionalPop: {},
    traits: [],
    vices: { alcohol: 'none', substances: 'none' },
  };

  const seeded = runSeeds(core, ctx.hooks ?? DEFAULT_SEED_HOOKS, {
    talent: talent.value,
    stage: stage.value,
    spec,
    worldDate: ctx.worldDate,
    rng: ctx.rng,
    tunables,
    library: ctx.library,
    geography: ctx.geography,
  });
  if (ctx.validate !== false) {
    assertValidPerson(seeded.person);
  }

  const identitySteps: TraceNode[] = [
    home.trace,
    gender.trace,
    stage.trace,
    age.trace,
    birth.trace,
    ...(debut === null
      ? [{ kind: 'note', label: 'No debut date for this role', value: null } as const]
      : [debut.trace]),
    motivation.trace,
    name.trace,
  ];
  const bodySteps: TraceNode[] = [
    style.trace,
    archetype.trace,
    measurements.heightCm.trace,
    measurements.weightKg.trace,
    group(
      'Body condition',
      `${experienceYears.toFixed(1)} years in the ring`,
      condition.traces.map((part) => part.trace),
    ),
    masked.trace,
  ];
  const attributeSteps: TraceNode[] = [
    talent.trace,
    ...attributes.traces.map((attribute) => attribute.trace),
  ];
  if (draws.standout.fired) {
    attributeSteps.push(rollNode(draws.standout.chanceRoll));
  }
  const root = group(
    `New ${ROLE_LABELS[spec.role]}: ${seeded.person.defaultRingName}`,
    seeded.person.defaultRingName,
    [
      group('Identity', `${STAGE_LABELS[stage.value]}, ${String(age.value)}`, identitySteps),
      group('Body', `${STYLE_LABELS[style.value]}, ${archetype.value.label}`, bodySteps),
      group('Attributes', `Talent ${formatNumber(talent.value)}`, attributeSteps),
      seeded.trace,
    ],
  );
  return traced({ person: seeded.person, talent: talent.value }, root);
}

// ---------------------------------------------------------------------------------------------
// A generator bound to one world

/** What a {@link PersonGenerator} is built from. */
export interface PersonGeneratorOptions {
  readonly library: ContentLibrary;
  readonly geography: Geography;
  readonly names: NameGenerator;
  /** Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
  /** The seeds to run. Defaults to the WLD-07 seeds; `{}` runs none. */
  readonly hooks?: PersonSeedHooks;
  /** Parse every result with `PersonSchema` (default true). */
  readonly validate?: boolean;
}

/** What changes from one call to the next: who the person is, today, and the RNG. */
export interface PersonGenerateRequest {
  readonly personId: GenerateContext['personId'];
  readonly worldDate: GenerateContext['worldDate'];
  readonly rng: StreamSource;
}

/**
 * {@link generatePerson} with the content, map, names, tunables and seeds fixed once, for callers
 * that generate many people (the default roster, daily newcomers, training schools).
 */
export class PersonGenerator {
  readonly #options: PersonGeneratorOptions;

  constructor(options: PersonGeneratorOptions) {
    this.#options = options;
  }

  /** A generator for `world`: its map, a name generator that knows its names, and `library`. */
  static forWorld(
    world: WorldView,
    library: ContentLibrary,
    options: Pick<PersonGeneratorOptions, 'tunables' | 'hooks' | 'validate'> = {},
  ): PersonGenerator {
    return new PersonGenerator({
      ...options,
      library,
      geography: geographyOf(world),
      names: NameGenerator.forWorld(world, library, options.tunables),
    });
  }

  /** The name generator this generator names people with (and whose registry it fills). */
  get names(): NameGenerator {
    return this.#options.names;
  }

  /** Generates one person for `spec`. See {@link generatePerson}. */
  generate(spec: GenerateSpec, request: PersonGenerateRequest): Traced<GeneratedPerson> {
    return generatePerson(spec, { ...this.#options, ...request });
  }
}
