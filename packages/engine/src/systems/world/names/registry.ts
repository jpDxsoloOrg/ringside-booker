/**
 * The name registry: every legal name and ring name already in use in a world, so the name
 * generator never hands out the same one twice.
 *
 * Names are compared in a normalised form (lower case, accents and punctuation removed, spaces
 * collapsed), so "José O'Neil" and "jose oneil" count as the same name. Each name remembers who
 * holds it, when that is known, so a person can be given a ring name equal to their own legal name
 * or keep a ring name they already hold.
 *
 * Design: docs/design/names.md#uniqueness.
 */

import { employmentsTable } from '../../../model/entities/employment';
import { peopleTable } from '../../../model/entities/person';
import { tableOf, type WorldView } from '../../../model/world';

/** Which namespace a name lives in: legal names and ring names are tracked separately. */
export type NameKind = 'legal' | 'ring';

/** Letters that Unicode does not split into a base letter and an accent. */
const UNSPLIT_LETTERS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

const UNSPLIT_PATTERN = new RegExp(`[${Object.keys(UNSPLIT_LETTERS).join('')}]`, 'g');

/**
 * The form names are compared in: lower case, accents stripped, punctuation removed (so
 * "O'Neil" and "ONeil" match), runs of spaces collapsed to one, no spaces at either end.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(UNSPLIT_PATTERN, (letter) => UNSPLIT_LETTERS[letter] ?? letter)
    .replace(/[^\p{L}\p{N}\s]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A legal display name: given name and family name, or just the given name when there is none. */
export function legalDisplayName(givenName: string, familyName: string): string {
  return familyName === '' ? givenName : `${givenName} ${familyName}`;
}

/** The names in use, by kind, each with the ID of whoever holds it (null when unknown). */
export class NameRegistry {
  readonly #holders: Record<NameKind, Map<string, string | null>> = {
    legal: new Map(),
    ring: new Map(),
  };

  /** The normalised form of a name. Same as {@link normaliseName}. */
  static normalise(name: string): string {
    return normaliseName(name);
  }

  /**
   * A registry of every name in `world`: each person's legal name and default ring name, and the
   * ring name on every employment (past ones included, so an old name is not reused).
   */
  static fromWorld(world: WorldView): NameRegistry {
    const registry = new NameRegistry();
    for (const person of tableOf(world, peopleTable).values()) {
      registry.add('legal', legalDisplayName(person.givenName, person.familyName), person.id);
      registry.add('ring', person.defaultRingName, person.id);
    }
    for (const employment of tableOf(world, employmentsTable).values()) {
      registry.add('ring', employment.ringName, employment.personId);
    }
    return registry;
  }

  /** True when the name (in any spelling that normalises the same) is in use. */
  has(kind: NameKind, name: string): boolean {
    return this.#holders[kind].has(normaliseName(name));
  }

  /**
   * True when the name is free, or held by `holderId` itself. A name with no known holder is never
   * free to anyone.
   */
  isFreeFor(kind: NameKind, name: string, holderId?: string): boolean {
    const holders = this.#holders[kind];
    const key = normaliseName(name);
    if (!holders.has(key)) {
      return true;
    }
    return holderId !== undefined && holders.get(key) === holderId;
  }

  /**
   * Marks a name as in use. The first holder recorded keeps it; adding it again (for the same or
   * another holder) changes nothing.
   */
  add(kind: NameKind, name: string, holderId?: string): void {
    const holders = this.#holders[kind];
    const key = normaliseName(name);
    if (!holders.has(key)) {
      holders.set(key, holderId ?? null);
    }
  }

  /** How many distinct names of this kind are in use. */
  size(kind: NameKind): number {
    return this.#holders[kind].size;
  }
}
