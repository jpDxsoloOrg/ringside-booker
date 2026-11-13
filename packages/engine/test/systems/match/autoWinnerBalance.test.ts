// The auto-winner's balance on the shipped default world (MTCH2-09): with the default tunables the
// higher-scored side wins about 70-80% of singles matches between a main eventer and a midcarder of
// the same promotion, and about 55-60% between two midcarders. Every pair is played out on its own
// seeded stream, so the counts are the same on every run. The numbers are recorded in
// docs/design/match-finishes.md#balance.
// Design: docs/design/match-finishes.md#auto-winner
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PersonId } from '../../../src/core/ids';
import { RngRegistry } from '../../../src/core/rng/registry';
import { findTraceNodes, traced } from '../../../src/core/trace';
import { tunableNode } from '../../../src/core/trace/tunable-node';
import type { Promotion } from '../../../src/model/entities/promotion';
import type { GameWorld } from '../../../src/model/tables';
import {
  loadWorldFromPacks,
  packManifestSchema,
  RECORD_KINDS,
  type RawPack,
  type RecordKind,
} from '../../../src/persistence/packs';
import {
  MATCH_AUTO_WINNER_STREAM,
  autoWinner,
  autoWinnerInputsOf,
  autoWinnerScore,
} from '../../../src/systems/match';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { SLOW_TESTS } from '../../support/slow';

const CONTENT_ROOT = fileURLToPath(new URL('../../../../../content/', import.meta.url));

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
function readContentPack(folder: string): RawPack {
  const packRoot = `${CONTENT_ROOT}${folder}/`;
  const manifest = packManifestSchema.parse(readJson(`${packRoot}pack.json`));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(`${packRoot}${file}`);
    }
  }
  return { manifest, files };
}

function defaultWorld(): GameWorld {
  const loaded = loadWorldFromPacks(
    [readContentPack('base'), readContentPack('worlds/default')],
    ['default-world'],
    { seed: 'auto-winner-balance' },
  );
  if (!loaded.ok) {
    throw new Error(`The default world did not load: ${JSON.stringify(loaded.issues)}`);
  }
  return loaded.value.world;
}

interface Pair {
  readonly promotion: Promotion;
  readonly first: PersonId;
  readonly second: PersonId;
}

interface Tally {
  readonly matches: number;
  readonly higherWins: number;
  readonly upsets: number;
}

/** Every promotion's active singles pairs: main eventer against midcarder, and two midcarders. */
function pairsOf(world: GameWorld): { mainVsMid: Pair[]; midVsMid: Pair[] } {
  const mainVsMid: Pair[] = [];
  const midVsMid: Pair[] = [];
  const promotions = [...world.tables.promotions.values()].sort((left, right) =>
    left.id < right.id ? -1 : 1,
  );
  for (const promotion of promotions) {
    const active = [...world.tables.employments.values()]
      .filter((employment) => employment.status === 'active')
      .filter((employment) => employment.promotionId === promotion.id)
      .sort((left, right) => (left.personId < right.personId ? -1 : 1));
    const mainEventers = active.filter((employment) => employment.push === 'mainEvent');
    const midcarders = active.filter((employment) => employment.push === 'midCard');
    for (const main of mainEventers) {
      for (const mid of midcarders) {
        mainVsMid.push({ promotion, first: main.personId, second: mid.personId });
      }
    }
    midcarders.forEach((mid, index) => {
      for (const other of midcarders.slice(index + 1)) {
        midVsMid.push({ promotion, first: mid.personId, second: other.personId });
      }
    });
  }
  return { mainVsMid, midVsMid };
}

/** Plays every pair `runs` times as an Auto singles match in the promotion's home region. */
function playOut(
  world: GameWorld,
  pairs: readonly Pair[],
  runs: number,
  tunables: EngineTunables,
): Tally {
  const randomness = traced(
    tunables.get('match.autoWinner.randomness'),
    tunableNode(tunables, 'match.autoWinner.randomness', 'Unpredictability'),
  );
  const upsetNoteGap = traced(
    tunables.get('match.autoWinner.upsetNoteGap'),
    tunableNode(tunables, 'match.autoWinner.upsetNoteGap', 'Upset gap'),
  );
  let matches = 0;
  let higherWins = 0;
  let upsets = 0;
  for (const pair of pairs) {
    const sides = autoWinnerInputsOf(world, {
      promotionId: pair.promotion.id,
      regionId: pair.promotion.homeRegionId,
      sides: [
        { side: 0, personIds: [pair.first] },
        { side: 1, personIds: [pair.second] },
      ],
    }).map((side) => ({
      side: side.side,
      label: side.sideLabel,
      score: autoWinnerScore(
        {
          sideLabel: side.sideLabel,
          regionName: 'Home',
          competitors: side.competitors,
          durationClass: 'standard',
          storylineHeat: side.storylineHeat,
        },
        { tunables },
      ),
      lowestPersonId: side.competitors[0]?.personId ?? pair.first,
    }));
    const [left, right] = sides;
    if (left === undefined || right === undefined || left.score.value === right.score.value) {
      continue;
    }
    const higher = left.score.value > right.score.value ? left.side : right.side;
    const rng = new RngRegistry(`balance-${pair.first}-${pair.second}`).stream(
      MATCH_AUTO_WINNER_STREAM,
    );
    for (let run = 0; run < runs; run += 1) {
      const winner = autoWinner({ sides, randomness, mode: 'standard', upsetNoteGap }, { rng });
      matches += 1;
      if (winner.value === higher) {
        higherWins += 1;
      }
      if (findTraceNodes(winner.trace, 'note').some((node) => node.label.startsWith('Upset:'))) {
        upsets += 1;
      }
    }
  }
  return { matches, higherWins, upsets };
}

function share(tally: Tally): number {
  return tally.higherWins / tally.matches;
}

describe('auto-winner balance on the default world', () => {
  const world = defaultWorld();
  const tunables = createEngineTunables({});
  const { mainVsMid, midVsMid } = pairsOf(world);
  // The fast run plays every pair a few times; the slow run plays each one 200 times.
  const runs = SLOW_TESTS ? 200 : 20;

  it('has main eventers and midcarders to pair', () => {
    expect(mainVsMid.length).toBeGreaterThan(50);
    expect(midVsMid.length).toBeGreaterThan(50);
  });

  it('a main eventer beats a midcarder about 70-80% of the time, with upsets', () => {
    const tally = playOut(world, mainVsMid, runs, tunables);
    expect(share(tally)).toBeGreaterThanOrEqual(0.7);
    expect(share(tally)).toBeLessThanOrEqual(0.8);
    expect(tally.upsets).toBeGreaterThan(0);
  });

  it('the higher-scored of two midcarders wins about 55-60% of the time', () => {
    const tally = playOut(world, midVsMid, runs, tunables);
    expect(share(tally)).toBeGreaterThanOrEqual(0.55);
    expect(share(tally)).toBeLessThanOrEqual(0.6);
  });

  it('gives the same counts for the same seeds', () => {
    const sample = mainVsMid.slice(0, 10);
    expect(playOut(world, sample, 10, tunables)).toEqual(playOut(world, sample, 10, tunables));
  });

  // Thousands of seeded matches: give a loaded machine room (slow suite only).
  it.runIf(SLOW_TESTS)('prints the recorded numbers', { timeout: 120_000 }, () => {
    const main = playOut(world, mainVsMid, runs, tunables);
    const mid = playOut(world, midVsMid, runs, tunables);
    console.info(
      `main eventer vs midcarder: ${String(mainVsMid.length)} pairs, ${String(main.matches)} matches, higher-scored won ${(share(main) * 100).toFixed(1)}%, called upsets ${String(main.upsets)}`,
    );
    console.info(
      `midcarder vs midcarder: ${String(midVsMid.length)} pairs, ${String(mid.matches)} matches, higher-scored won ${(share(mid) * 100).toFixed(1)}%, called upsets ${String(mid.upsets)}`,
    );
  });
});
