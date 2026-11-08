import { describe, expect, it } from 'vitest';
import { IdCollisionError } from '../../../src/core/errors';
import {
  createIdFactory,
  ENTITY_KIND_LIST,
  ID_MAX_ATTEMPTS,
  isId,
  type PersonId,
} from '../../../src/core/ids';
import { createIdMinter, idStreamName } from '../../../src/core/rng/ids';
import { RngRegistry } from '../../../src/core/rng/registry';

const SEED = 'rb-ids';
const neverExists = (): boolean => false;

function mintPeople(rng: RngRegistry, count: number): PersonId[] {
  const minter = createIdMinter(rng);
  return Array.from({ length: count }, () => minter.next('person', neverExists));
}

describe('createIdMinter', () => {
  it('mints the same first 100 person IDs for the same seed', () => {
    const first = mintPeople(new RngRegistry(SEED), 100);
    const second = mintPeople(new RngRegistry(SEED), 100);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(100);
    expect(mintPeople(new RngRegistry('another-seed'), 100)).not.toEqual(first);
  });

  it('keeps each kind independent: minting promotions in between leaves people unchanged', () => {
    const expectedPeople = mintPeople(new RngRegistry(SEED), 20);

    const minter = createIdMinter(new RngRegistry(SEED));
    const interleavedPeople: PersonId[] = [];
    for (let index = 0; index < 20; index++) {
      interleavedPeople.push(minter.next('person', neverExists));
      minter.next('promotion', neverExists);
      minter.next('title', neverExists);
    }
    expect(interleavedPeople).toEqual(expectedPeople);
  });

  it('skips taken candidates: with the first two taken it returns the third', () => {
    const [firstCandidate, secondCandidate, thirdCandidate] = mintPeople(new RngRegistry(SEED), 3);
    const taken = new Set<PersonId>([firstCandidate!, secondCandidate!]);
    const minter = createIdMinter(new RngRegistry(SEED));
    expect(minter.next('person', (candidate) => taken.has(candidate))).toBe(thirdCandidate);
  });

  it('surfaces the ID factory collision limit as IdCollisionError', () => {
    const minter = createIdMinter(new RngRegistry(SEED));
    let candidatesSeen = 0;
    expect(() =>
      minter.next('person', () => {
        candidatesSeen++;
        return true;
      }),
    ).toThrow(IdCollisionError);
    expect(candidatesSeen).toBe(ID_MAX_ATTEMPTS);
  });

  it('mints valid IDs for every kind', () => {
    const minter = createIdMinter(new RngRegistry(SEED));
    for (const kind of ENTITY_KIND_LIST) {
      const id = minter.next(kind, neverExists);
      expect(isId(kind, id), `${kind}: ${id}`).toBe(true);
    }
  });

  it('mints season IDs from the ids.sea stream', () => {
    const rng = new RngRegistry(SEED);
    const seasonId = createIdMinter(rng).next('season', neverExists);
    expect(isId('season', seasonId)).toBe(true);
    expect(idStreamName('season')).toBe('ids.sea');
    expect(Object.keys(rng.toState().streams)).toEqual(['ids.sea']);

    const directFactory = createIdFactory(new RngRegistry(SEED).stream('ids.sea'));
    expect(directFactory.next('season', neverExists)).toBe(seasonId);
  });

  it('rewinds with the registry: snapshot, mint 5, restore, mint 5 gives the same IDs', () => {
    const rng = new RngRegistry(SEED);
    const minter = createIdMinter(rng);
    minter.next('person', neverExists);

    const snapshot = rng.snapshot();
    const beforeRestore = Array.from({ length: 5 }, () => minter.next('person', neverExists));
    rng.restore(snapshot);
    const afterRestore = Array.from({ length: 5 }, () => minter.next('person', neverExists));
    expect(afterRestore).toEqual(beforeRestore);
  });

  it('rewinds a stream first touched after the snapshot and keeps saving it', () => {
    const rng = new RngRegistry(SEED);
    const minter = createIdMinter(rng);

    const snapshot = rng.snapshot();
    const beforeRestore = Array.from({ length: 5 }, () => minter.next('person', neverExists));
    rng.restore(snapshot);
    const afterRestore = Array.from({ length: 5 }, () => minter.next('person', neverExists));
    expect(afterRestore).toEqual(beforeRestore);

    // The minter keeps drawing after the restore, so the stream must still be in the save.
    const saved = rng.toState();
    expect(Object.keys(saved.streams)).toEqual(['ids.per']);
    const reloadedMinter = createIdMinter(RngRegistry.fromState(saved));
    const continuing = createIdMinter(new RngRegistry(SEED));
    const expectedNext = Array.from({ length: 6 }, () => continuing.next('person', neverExists));
    expect(reloadedMinter.next('person', neverExists)).toBe(expectedNext[5]);
  });
});
