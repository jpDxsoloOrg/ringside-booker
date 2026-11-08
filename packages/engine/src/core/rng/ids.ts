/**
 * Deterministic ID minting: the ID factory from `core/ids` backed by seeded RNG streams.
 *
 * Each entity kind draws from its own stream, `ids.<prefix>` (`ids.per`, `ids.sea`, ...), so a
 * new system that creates titles never changes the IDs of people created on the same day. This
 * file only routes kinds to streams. The ID format, body length and collision retries all stay
 * in `core/ids`, the single definition of what an ID looks like.
 *
 * See `docs/design/determinism.md`.
 */

import {
  createIdFactory,
  ENTITY_KINDS,
  type EntityKind,
  type IdEntropy,
  type IdFactory,
  type IdOf,
} from '../ids';
import type { RngRegistry } from './registry';
import type { StreamName } from './streams';

/** An {@link IdFactory} that mints from the RNG registry. Installed on the world at runtime. */
export type IdMinter = IdFactory;

/** The stream an entity kind's IDs come from, for example `ids.per` for people. */
export function idStreamName(kind: EntityKind): StreamName {
  return `ids.${ENTITY_KINDS[kind]}`;
}

/**
 * Entropy that asks the registry for the stream on every draw instead of holding the stream
 * object. The registry returns the same live stream each time, so a snapshot restore rewinds
 * minting too, and asking through the registry keeps the stream marked as touched (and so saved)
 * even after a restore has reset it.
 */
function registryEntropy(rng: RngRegistry, streamName: StreamName): IdEntropy {
  return {
    nextUint32(): number {
      return rng.stream(streamName).nextUint32();
    },
  };
}

/**
 * Creates the game's ID minter over an RNG registry. The per-kind factories are built lazily on
 * first use. The same seed and the same creation order give the same IDs, independently per kind.
 */
export function createIdMinter(rng: RngRegistry): IdMinter {
  const factoriesByKind = new Map<EntityKind, IdFactory>();

  function factoryFor(kind: EntityKind): IdFactory {
    const existing = factoriesByKind.get(kind);
    if (existing !== undefined) {
      return existing;
    }
    const created = createIdFactory(registryEntropy(rng, idStreamName(kind)));
    factoriesByKind.set(kind, created);
    return created;
  }

  return {
    next<K extends EntityKind>(kind: K, exists: (id: IdOf<K>) => boolean): IdOf<K> {
      return factoryFor(kind).next(kind, exists);
    },
  };
}
