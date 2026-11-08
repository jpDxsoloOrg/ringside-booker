/**
 * The name generator: believable legal names for people from any country, and ring names for
 * wrestlers, drawn deterministically from named RNG streams.
 *
 * Legal names: a country's name mix says which name cultures its people are named from and how
 * often. The generator picks a culture by weight, then a given name from that culture's list for
 * the person's gender (or its neutral list), then a surname from the same culture (or, now and
 * then, from a second pick of the mix). Ring names fill a weighted pattern such as
 * `{adjective} {noun}` from the ring name words.
 *
 * Every name is checked against the {@link NameRegistry}. A name that is taken is rolled again up
 * to `worldgen.names.maxRetries` times; after that the generator tries the last name with each
 * middle initial A-Z in a shuffled order, and if all of those are taken it throws
 * `NameSpaceExhaustedError`. That error means the content is too small for the world, never
 * something the game recovers from.
 *
 * Draw order (fixed, so a seed always gives the same names):
 * - legal name, per attempt on `worldgen.names.person`: culture, gender list roll(s), given name,
 *   mixed heritage roll, [second culture], surname, [double surname roll, [second surname]]; then
 *   the middle initial shuffle if every attempt was taken.
 * - ring name, per attempt on `worldgen.names.ring`: pattern, then one word per word placeholder in
 *   the order they appear; then the middle initial shuffle if needed.
 *
 * Design: docs/design/names.md.
 */

import './streams';
import { InvalidArgumentError, NameSpaceExhaustedError } from '../../../core/errors';
import type { CountryId, PersonId } from '../../../core/ids';
import {
  pick,
  rollChance,
  rollWeighted,
  shuffle,
  type RngStream,
  type RollRecord,
  type WeightedEntry,
} from '../../../core/rng';
import { startDecision, type Decision, type Traced } from '../../../core/trace';
import type { Gender, RingStyle } from '../../../model/entities/person';
import { RING_NAME_MAX_LENGTH } from '../../../model/entities/person';
import type { WorldView } from '../../../model/world';
import type { ContentLibrary } from '../../../persistence/packs/library';
import {
  isRingNamePlaceholder,
  placeholdersIn,
  type NameCultureRecord,
  type RingNamePlaceholder,
} from '../../../persistence/packs/records/names';
import { createEngineTunables, type EngineTunables } from '../../tunables';
import { legalDisplayName, NameRegistry } from './registry';
import { buildWeightedTable, pickTableEntry, type WeightedTable } from './weighted';

/** A legal name, in the FND-06 person fields. `display` also seeds `defaultRingName`. */
export interface PersonName {
  readonly givenName: string;
  readonly familyName: string;
  readonly display: string;
}

/** What a legal name is generated for. */
export interface PersonNameRequest {
  readonly countryId: CountryId;
  readonly gender: Gender;
  /** The person the name is for, when they already have an ID; recorded as the name's holder. */
  readonly personId?: PersonId;
}

/** The person a ring name is made for. */
export interface RingNamePerson {
  readonly id?: PersonId;
  readonly givenName: string;
  readonly familyName: string;
}

/** What a ring name is generated for. */
export interface RingNameRequest {
  readonly person: RingNamePerson;
  /**
   * The person's ring style. `nonWrestler` (managers and other talkers) only gets name-based
   * patterns such as `{given} {family}`; every other style can get any pattern.
   */
  readonly style: RingStyle;
}

export interface NameGeneratorOptions {
  /** The tunables to read. Defaults to every engine tunable at its default value. */
  readonly tunables?: EngineTunables;
  /** Country ID → country pack key, as in `WorldMeta.contentKeys.country`. */
  readonly countryKeys?: Readonly<Record<string, string>>;
}

const LEGAL_DOC_REF = 'names.md#legal-names';
const RING_DOC_REF = 'names.md#ring-names';

/** The letters a middle initial is drawn from. */
const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** A trailing middle initial such as ` J.` that a fallback name added to a given name. */
const MIDDLE_INITIAL_SUFFIX = / \p{Lu}\.$/u;

/** A `{placeholder}` in a ring name pattern. */
const PLACEHOLDER_IN_PATTERN = /\{([^{}]*)\}/g;

/** The placeholders a name-only (non-wrestler) ring name may use. */
const NAME_PLACEHOLDERS: readonly RingNamePlaceholder[] = ['given', 'family'];

// ---------------------------------------------------------------------------------------------
// The compiled library: weighted tables built once per content library

interface CompiledCulture {
  readonly key: string;
  readonly label: string;
  readonly male: WeightedTable;
  readonly female: WeightedTable;
  /** Null when the culture has no neutral names. */
  readonly neutral: WeightedTable | null;
  readonly surnames: WeightedTable;
  /** The chance of two surnames; 0 for cultures whose style is not `double`. */
  readonly doubleSurnameChance: number;
}

interface CompiledRingWords {
  readonly adjectives: readonly string[];
  readonly nouns: readonly string[];
  readonly nicknames: readonly string[];
  readonly patterns: readonly WeightedEntry<string>[];
  /** The patterns that use only `{given}` and `{family}`. */
  readonly namePatterns: readonly WeightedEntry<string>[];
}

interface CompiledNames {
  readonly cultures: ReadonlyMap<string, CompiledCulture>;
  /** Country key → culture keys with weights. */
  readonly mixes: ReadonlyMap<string, readonly WeightedEntry<string>[]>;
  readonly ringWords: CompiledRingWords;
}

function compileCulture(culture: NameCultureRecord): CompiledCulture {
  return {
    key: culture.key,
    label: culture.label,
    male: buildWeightedTable(culture.given.male),
    female: buildWeightedTable(culture.given.female),
    neutral: culture.given.neutral.length === 0 ? null : buildWeightedTable(culture.given.neutral),
    surnames: buildWeightedTable(culture.surnames),
    doubleSurnameChance: culture.surnameStyle === 'double' ? (culture.doubleSurnameChance ?? 0) : 0,
  };
}

function uniqueInOrder(words: readonly string[]): string[] {
  return [...new Set(words)];
}

/** Every ring name words record merged in key order: words without repeats, patterns first wins. */
function compileRingWords(library: ContentLibrary): CompiledRingWords {
  const records = Object.keys(library.ringNameWords)
    .sort()
    .flatMap((key) => {
      const record = library.ringNameWords[key];
      return record === undefined ? [] : [record];
    });
  const patterns: WeightedEntry<string>[] = [];
  const seenPatterns = new Set<string>();
  for (const record of records) {
    for (const [pattern, weight] of record.patterns) {
      if (!seenPatterns.has(pattern)) {
        seenPatterns.add(pattern);
        patterns.push({ item: pattern, weight });
      }
    }
  }
  return {
    adjectives: uniqueInOrder(records.flatMap((record) => record.adjectives)),
    nouns: uniqueInOrder(records.flatMap((record) => record.nouns)),
    nicknames: uniqueInOrder(records.flatMap((record) => record.nicknames)),
    patterns,
    namePatterns: patterns.filter((entry) =>
      placeholdersIn(entry.item).every((placeholder) =>
        NAME_PLACEHOLDERS.some((allowed) => allowed === placeholder),
      ),
    ),
  };
}

function compileLibrary(library: ContentLibrary): CompiledNames {
  const cultures = new Map<string, CompiledCulture>();
  for (const key of Object.keys(library.nameCultures).sort()) {
    const culture = library.nameCultures[key];
    if (culture !== undefined) {
      cultures.set(key, compileCulture(culture));
    }
  }
  const mixes = new Map<string, readonly WeightedEntry<string>[]>();
  for (const key of Object.keys(library.countryNameMixes).sort()) {
    const mix = library.countryNameMixes[key];
    if (mix !== undefined) {
      mixes.set(
        mix.countryKey,
        mix.cultures.map((entry) => ({ item: entry.cultureKey, weight: entry.weight })),
      );
    }
  }
  return { cultures, mixes, ringWords: compileRingWords(library) };
}

/** Compiled tables per library. Libraries are frozen, so a library's tables never go stale. */
const compiledByLibrary = new WeakMap<ContentLibrary, CompiledNames>();

function compiledNamesOf(library: ContentLibrary): CompiledNames {
  let compiled = compiledByLibrary.get(library);
  if (compiled === undefined) {
    compiled = compileLibrary(library);
    compiledByLibrary.set(library, compiled);
  }
  return compiled;
}

// ---------------------------------------------------------------------------------------------
// Rolls

/** A table pick as a roll record for the trace. */
function tableRoll(
  stream: RngStream,
  table: WeightedTable,
  label: string,
): { name: string; roll: RollRecord } {
  const picked = pickTableEntry(stream, table);
  return {
    name: picked.name,
    roll: {
      stream: stream.name,
      kind: 'weighted',
      label,
      odds: picked.weight / picked.total,
      options: table.names.length,
      result: picked.name,
    },
  };
}

/** A legal name candidate and the trace steps that produced it. */
interface LegalCandidate {
  readonly givenName: string;
  readonly familyName: string;
  readonly steps: readonly ((decision: Decision<string>) => void)[];
}

/** The given-name list a legal name drew from. */
interface GivenList {
  readonly name: 'male' | 'female' | 'neutral';
  readonly table: WeightedTable;
}

interface LegalSettings {
  readonly neutralShare: number;
  readonly nonbinaryNeutralShare: number;
  readonly mixedHeritageChance: number;
}

/** A ring name candidate: the name, or why the pattern could not be filled. */
type RingCandidate =
  | {
      readonly ok: true;
      readonly name: string;
      readonly pattern: string;
      readonly rolls: RollRecord[];
    }
  | { readonly ok: false; readonly reason: string; readonly pattern: string };

/** The given name without a middle initial added by an earlier fallback ("Jack R." → "Jack"). */
function baseGivenName(givenName: string): string {
  return givenName.replace(MIDDLE_INITIAL_SUFFIX, '');
}

/** The word list a word placeholder draws from. */
function wordListFor(
  words: CompiledRingWords,
  placeholder: 'adjective' | 'noun' | 'nickname',
): readonly string[] {
  switch (placeholder) {
    case 'adjective':
      return words.adjectives;
    case 'noun':
      return words.nouns;
    case 'nickname':
      return words.nicknames;
  }
}

// ---------------------------------------------------------------------------------------------
// The generator

/**
 * Generates legal names and ring names that are unique in one world. Adds every name it hands out
 * to its registry, so two calls never return the same name.
 */
export class NameGenerator {
  readonly #compiled: CompiledNames;
  readonly #registry: NameRegistry;
  readonly #tunables: EngineTunables;
  readonly #countryKeys: Readonly<Record<string, string>>;

  constructor(library: ContentLibrary, registry: NameRegistry, options: NameGeneratorOptions = {}) {
    this.#compiled = compiledNamesOf(library);
    this.#registry = registry;
    this.#tunables = options.tunables ?? createEngineTunables();
    this.#countryKeys = options.countryKeys ?? {};
  }

  /**
   * A generator for `world`: its registry holds every name already in the world, and country IDs
   * are resolved through the world's content keys.
   */
  static forWorld(
    world: WorldView,
    library: ContentLibrary,
    tunables?: EngineTunables,
  ): NameGenerator {
    return new NameGenerator(library, NameRegistry.fromWorld(world), {
      countryKeys: invertKeys(world.meta.contentKeys['country'] ?? {}),
      ...(tunables === undefined ? {} : { tunables }),
    });
  }

  /** The registry this generator checks and fills. */
  get registry(): NameRegistry {
    return this.#registry;
  }

  /**
   * A new, unused legal name for someone from `countryId`. Draws only from `stream` (normally
   * `worldgen.names.person`) and adds the name to the registry.
   *
   * @throws InvalidArgumentError when the country has no key or no name mix, or the mix names a
   *   culture the library does not have.
   * @throws NameSpaceExhaustedError when every attempt and every middle initial is taken.
   */
  personName(stream: RngStream, request: PersonNameRequest): Traced<PersonName> {
    const countryKey = this.#countryKeyOf(request.countryId);
    const mix = this.#compiled.mixes.get(countryKey);
    if (mix === undefined) {
      throw new InvalidArgumentError(
        'NameGenerator.personName',
        'countryId',
        request.countryId,
        `a country with a name mix (country ${countryKey} has none)`,
      );
    }
    const decision = startDecision<string>('Legal name', { docRef: LEGAL_DOC_REF });
    decision.note(`Born in ${countryKey}; gender ${request.gender}`);
    const settings: LegalSettings = {
      neutralShare: decision.tunable(this.#tunables, 'worldgen.names.neutralGivenShare'),
      nonbinaryNeutralShare: decision.tunable(
        this.#tunables,
        'worldgen.names.nonbinaryNeutralShare',
      ),
      mixedHeritageChance: decision.tunable(this.#tunables, 'worldgen.names.mixedHeritageChance'),
    };
    const maxRetries = decision.tunable(this.#tunables, 'worldgen.names.maxRetries');
    const mixTotal = mix.reduce((sum, entry) => sum + entry.weight, 0);

    let last: LegalCandidate | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const candidate = this.#rollLegalCandidate(stream, mix, mixTotal, request.gender, settings);
      const display = legalDisplayName(candidate.givenName, candidate.familyName);
      if (this.#registry.isFreeFor('legal', display, request.personId)) {
        for (const step of candidate.steps) {
          step(decision);
        }
        return this.#acceptLegal(decision, candidate.givenName, candidate.familyName, request);
      }
      decision.note(
        `Attempt ${String(attempt + 1)}: ${display} is already taken, so the name is rolled again`,
      );
      last = candidate;
    }

    if (last !== null) {
      for (const step of last.steps) {
        step(decision);
      }
      const givenBase = baseGivenName(last.givenName);
      for (const letter of shuffle(stream, INITIALS)) {
        const givenName = `${givenBase} ${letter}.`;
        const display = legalDisplayName(givenName, last.familyName);
        if (this.#registry.isFreeFor('legal', display, request.personId)) {
          decision.note(`Every roll was taken, so a middle initial was added: ${letter}.`);
          return this.#acceptLegal(decision, givenName, last.familyName, request);
        }
        decision.note(`With middle initial ${letter}.: ${display} is already taken`);
      }
    }
    throw new NameSpaceExhaustedError('legal', countryKey, maxRetries + 1 + INITIALS.length);
  }

  /**
   * A new ring name for `person`, unique among every ring name and every other person's legal
   * name. The person's own legal name is allowed. Draws only from `stream` (normally
   * `worldgen.names.ring`) and adds the name to the registry.
   *
   * @throws NameSpaceExhaustedError when every attempt, the legal name and every middle initial
   *   are taken.
   */
  ringName(stream: RngStream, request: RingNameRequest): Traced<string> {
    const { person, style } = request;
    const words = this.#compiled.ringWords;
    const decision = startDecision<string>('Ring name', { docRef: RING_DOC_REF });
    const ownLegalName = legalDisplayName(person.givenName, person.familyName);
    decision.note(`For ${ownLegalName}, ring style ${style}`);
    const maxRetries = decision.tunable(this.#tunables, 'worldgen.names.maxRetries');
    const namesOnly = style === 'nonWrestler' && words.namePatterns.length > 0;
    const patterns = namesOnly ? words.namePatterns : words.patterns;
    decision.rule('Name-based patterns only (non-wrestler)', namesOnly);

    if (patterns.length > 0) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const candidate = this.#fillPattern(stream, patterns, person);
        if (!candidate.ok) {
          decision.note(`Attempt ${String(attempt + 1)}: ${candidate.reason}`);
          continue;
        }
        if (this.#ringNameFree(candidate.name, person, ownLegalName)) {
          for (const roll of candidate.rolls) {
            decision.roll(roll);
          }
          decision.note(`Pattern ${candidate.pattern} gives ${candidate.name}`);
          return this.#acceptRing(
            decision,
            candidate.name,
            person,
            'Pattern filled from the ring name words',
          );
        }
        decision.note(
          `Attempt ${String(attempt + 1)}: ${candidate.name} (pattern ${candidate.pattern}) is already taken, so the name is rolled again`,
        );
      }
    }

    const givenBase = baseGivenName(person.givenName);
    const plainName = legalDisplayName(givenBase, person.familyName);
    if (this.#ringNameFree(plainName, person, ownLegalName)) {
      return this.#acceptRing(
        decision,
        plainName,
        person,
        'Every roll was taken, so the legal name is used',
      );
    }
    for (const letter of shuffle(stream, INITIALS)) {
      const name = legalDisplayName(`${givenBase} ${letter}.`, person.familyName);
      if (this.#ringNameFree(name, person, ownLegalName)) {
        return this.#acceptRing(
          decision,
          name,
          person,
          `Every roll and the legal name were taken, so a middle initial was added: ${letter}.`,
        );
      }
      decision.note(`With middle initial ${letter}.: ${name} is already taken`);
    }
    throw new NameSpaceExhaustedError('ring', 'ring names', maxRetries + 2 + INITIALS.length);
  }

  #countryKeyOf(countryId: CountryId): string {
    const key = this.#countryKeys[countryId];
    if (key === undefined) {
      throw new InvalidArgumentError(
        'NameGenerator.personName',
        'countryId',
        countryId,
        'a country ID listed in the generator country keys',
      );
    }
    return key;
  }

  #culture(cultureKey: string): CompiledCulture {
    const culture = this.#compiled.cultures.get(cultureKey);
    if (culture === undefined) {
      throw new InvalidArgumentError(
        'NameGenerator.personName',
        'cultureKey',
        cultureKey,
        'a name culture in the content library',
      );
    }
    return culture;
  }

  /** One full roll of a legal name. Records its steps for the trace but does not apply them. */
  #rollLegalCandidate(
    stream: RngStream,
    mix: readonly WeightedEntry<string>[],
    mixTotal: number,
    gender: Gender,
    settings: LegalSettings,
  ): LegalCandidate {
    const steps: ((decision: Decision<string>) => void)[] = [];
    const culturePick = rollWeighted(stream, mix, 'Name culture', (key) => key);
    const culture = this.#culture(culturePick.value);
    const cultureWeight = mix.find((entry) => entry.item === culture.key)?.weight ?? 0;
    steps.push((decision) => {
      decision.roll(culturePick.roll);
      decision.note(
        `Culture ${culture.label}: weight ${String(cultureWeight)} of ${String(mixTotal)} in the country mix`,
      );
    });

    // Which given-name list: own gender's or neutral (men and women); neutral, male or female
    // (non-binary). The rolls are always drawn, even when a list is empty, so the draw count
    // never depends on the content.
    let list: GivenList;
    if (gender === 'nonBinary') {
      const neutralRoll = rollChance(
        stream,
        settings.nonbinaryNeutralShare,
        'Given name from the neutral list',
      );
      const maleRoll = rollChance(stream, 0.5, 'Male list rather than female (when not neutral)');
      steps.push((decision) => {
        decision.roll(neutralRoll.roll);
      });
      if (neutralRoll.value && culture.neutral !== null) {
        list = { name: 'neutral', table: culture.neutral };
      } else {
        steps.push((decision) => {
          decision.roll(maleRoll.roll);
        });
        list = maleRoll.value
          ? { name: 'male', table: culture.male }
          : { name: 'female', table: culture.female };
      }
    } else {
      const neutralRoll = rollChance(
        stream,
        settings.neutralShare,
        'Given name from the neutral list',
      );
      steps.push((decision) => {
        decision.roll(neutralRoll.roll);
      });
      list =
        neutralRoll.value && culture.neutral !== null
          ? { name: 'neutral', table: culture.neutral }
          : { name: gender, table: culture[gender] };
    }
    if (culture.neutral === null) {
      steps.push((decision) => {
        decision.note(`${culture.label} has no neutral given names`);
      });
    }
    const chosenList = list;
    const given = tableRoll(
      stream,
      chosenList.table,
      `Given name (${culture.label}, ${chosenList.name} list)`,
    );
    steps.push((decision) => {
      decision.note(`List used: ${culture.label} ${chosenList.name} given names`);
      decision.roll(given.roll);
    });

    const mixedRoll = rollChance(
      stream,
      settings.mixedHeritageChance,
      'Surname from a second pick of the mix',
    );
    steps.push((decision) => {
      decision.roll(mixedRoll.roll);
    });
    let surnameCulture = culture;
    if (mixedRoll.value) {
      const secondPick = rollWeighted(stream, mix, 'Surname culture', (key) => key);
      surnameCulture = this.#culture(secondPick.value);
      const second = surnameCulture;
      steps.push((decision) => {
        decision.roll(secondPick.roll);
        decision.note(`Mixed heritage: surname from ${second.label}`);
      });
    }
    const surnameCultureFinal = surnameCulture;
    const surname = tableRoll(
      stream,
      surnameCultureFinal.surnames,
      `Surname (${surnameCultureFinal.label})`,
    );
    steps.push((decision) => {
      decision.roll(surname.roll);
    });
    let familyName = surname.name;
    if (surnameCultureFinal.doubleSurnameChance > 0) {
      const doubleRoll = rollChance(
        stream,
        surnameCultureFinal.doubleSurnameChance,
        'Two surnames',
      );
      steps.push((decision) => {
        decision.roll(doubleRoll.roll);
      });
      if (doubleRoll.value) {
        const secondSurname = tableRoll(
          stream,
          surnameCultureFinal.surnames,
          `Second surname (${surnameCultureFinal.label})`,
        );
        steps.push((decision) => {
          decision.roll(secondSurname.roll);
        });
        if (secondSurname.name !== surname.name) {
          familyName = `${surname.name} ${secondSurname.name}`;
        }
      }
    }
    return { givenName: given.name, familyName, steps };
  }

  #acceptLegal(
    decision: Decision<string>,
    givenName: string,
    familyName: string,
    request: PersonNameRequest,
  ): Traced<PersonName> {
    const display = legalDisplayName(givenName, familyName);
    this.#registry.add('legal', display, request.personId);
    const traced = decision.choose(display, 'The first free name rolled');
    return { value: { givenName, familyName, display }, trace: traced.trace };
  }

  #ringNameFree(name: string, person: RingNamePerson, ownLegalName: string): boolean {
    if (!this.#registry.isFreeFor('ring', name, person.id)) {
      return false;
    }
    if (NameRegistry.normalise(name) === NameRegistry.normalise(ownLegalName)) {
      return true;
    }
    return this.#registry.isFreeFor('legal', name, person.id);
  }

  /** Picks a pattern and fills its placeholders, one draw per word, in order. */
  #fillPattern(
    stream: RngStream,
    patterns: readonly WeightedEntry<string>[],
    person: RingNamePerson,
  ): RingCandidate {
    const words = this.#compiled.ringWords;
    const patternPick = rollWeighted(stream, patterns, 'Ring name pattern', (pattern) => pattern);
    const pattern = patternPick.value;
    const rolls: RollRecord[] = [patternPick.roll];
    const givenBase = baseGivenName(person.givenName);
    const parts: string[] = [];
    let position = 0;
    for (const match of pattern.matchAll(PLACEHOLDER_IN_PATTERN)) {
      parts.push(pattern.slice(position, match.index));
      position = match.index + match[0].length;
      const placeholder = match[1] ?? '';
      if (!isRingNamePlaceholder(placeholder)) {
        return {
          ok: false,
          reason: `pattern ${pattern} has an unknown placeholder {${placeholder}}`,
          pattern,
        };
      }
      if (placeholder === 'given') {
        parts.push(givenBase);
        continue;
      }
      if (placeholder === 'family') {
        if (person.familyName === '') {
          return {
            ok: false,
            reason: `pattern ${pattern} needs a family name and there is none`,
            pattern,
          };
        }
        parts.push(person.familyName);
        continue;
      }
      const list = wordListFor(words, placeholder);
      if (list.length === 0) {
        return {
          ok: false,
          reason: `pattern ${pattern} needs a ${placeholder} and the word list is empty`,
          pattern,
        };
      }
      const word = pick(stream, list);
      rolls.push({
        stream: stream.name,
        kind: 'pick',
        label: `Ring name ${placeholder}`,
        odds: 1 / list.length,
        options: list.length,
        result: word,
      });
      parts.push(word);
    }
    parts.push(pattern.slice(position));
    const name = parts.join('');
    const cleaned = name.replace(/\s+/g, ' ').trim();
    if (cleaned.length === 0 || cleaned.length > RING_NAME_MAX_LENGTH) {
      return {
        ok: false,
        reason: `${cleaned} (pattern ${pattern}) is longer than ${String(RING_NAME_MAX_LENGTH)} characters`,
        pattern,
      };
    }
    return { ok: true, name: cleaned, pattern, rolls };
  }

  #acceptRing(
    decision: Decision<string>,
    name: string,
    person: RingNamePerson,
    because: string,
  ): Traced<string> {
    this.#registry.add('ring', name, person.id);
    return decision.choose(name, because);
  }
}

function invertKeys(keyToId: Readonly<Record<string, string>>): Record<string, string> {
  const idToKey: Record<string, string> = {};
  for (const key of Object.keys(keyToId).sort()) {
    const id = keyToId[key];
    if (id !== undefined) {
      idToKey[id] = key;
    }
  }
  return idToKey;
}
