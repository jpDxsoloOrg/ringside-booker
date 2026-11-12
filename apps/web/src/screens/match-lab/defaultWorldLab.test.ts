// The Match lab's hand-test script (MTCH1-09) run against a new default-world game as Altura
// Wrestling Entertainment: the defaults, every number's Why? in the words the panel shows (readable
// labels, the settings named by key, no raw codes, no broken numbers, nothing about running time),
// the first tuning pass's checks from docs/design/match-rating.md, and an old save without catalogs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  createNewGame,
  defaultSystems,
  documentToWorld,
  initialEngineState,
  OMNISCIENT_VIEWER,
  packManifestSchema,
  RECORD_KINDS,
  SLOT_ROLES,
  TABLES,
} from '@ringside/engine';
import type {
  ContentKey,
  Engine,
  LabOptions,
  LabWorkerRow,
  MatchCatalog,
  PreviewArgs,
  PreviewBatchResult,
  PreviewResult,
  RawPack,
  RecordKind,
  SlotRole,
  TraceNode,
  Viewer,
} from '@ringside/engine';
import { tinySaveDocument } from '@ringside/engine/testing';
import { traceToText } from '@/components/Trace/traceToText';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';

// A path, not a URL: under jsdom the URL class is not the one node:fs accepts.
const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../content');

const PLAYER_ID = 'local-player';
const PLAYER_PROMOTION_KEY = 'pro-flagship';
const PLAYER_PROMOTION_NAME = 'Altura Wrestling Entertainment';
const VIEWER: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: PLAYER_ID } };

/** Run x100, as the lab's button does. */
const BATCH_RUNS = 100;
const AUDIT_TIMEOUT_MS = 60_000;

/** What a number or a name that failed to format leaves behind. */
const BROKEN_TEXT = /undefined|NaN|Infinity|\[object /;
/** A camelCase code, such as `mainEvent`, outside a dotted setting key or stream name. */
const RAW_CODE = /(?<![.\w])[a-z]+[A-Z]\w*(?![.\w])/;
/** The words the ticket bans on the lab: no running time (D-10). */
const MINUTES = /\bminutes?\b|\bmins?\b/i;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Reads a shipped pack the way the tools do: its manifest and every file the manifest lists. */
function readContentPack(folder: string): RawPack {
  const packRoot = join(CONTENT_ROOT, folder);
  const manifest = packManifestSchema.parse(readJson(join(packRoot, 'pack.json')));
  const files: Partial<Record<RecordKind, unknown>> = {};
  for (const kind of RECORD_KINDS) {
    const file = manifest.files[kind];
    if (file !== undefined) {
      files[kind] = readJson(join(packRoot, file));
    }
  }
  return { manifest, files };
}

/** A new game on the default world, playing Altura, before any day has run. */
function startDefaultGame(): Engine {
  const game = createNewGame([readContentPack('base'), readContentPack('worlds/default')], {
    rootPackId: 'default-world',
    seed: 'match-lab-owner-test',
    playerId: PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: 'Match lab owner test',
    seasonLength: { preset: '6m' },
    player: { mode: 'existing', promotionKey: PLAYER_PROMOTION_KEY },
    settings: {},
  });
  if (!game.ok) {
    throw new Error(`The new game was refused: ${JSON.stringify(game.reasons)}`);
  }
  return createEngine({ state: game.state, systems: defaultSystems });
}

const engine = startDefaultGame();

function ask<T>(answer: { ok: true; data: T } | { ok: false; reasons: unknown }, name: string): T {
  if (!answer.ok) throw new Error(`${name} was refused: ${JSON.stringify(answer.reasons)}`);
  return answer.data;
}

const options: LabOptions = ask(engine.query('match.labOptions', {}, VIEWER), 'match.labOptions');
const catalog: MatchCatalog = ask(engine.query('match.catalog', {}, VIEWER), 'match.catalog');
const homeRegion = options.defaults.regionId;
if (homeRegion === null) throw new Error('The default world has no regions.');
const regionId = homeRegion;

/** The roster as the picker's My roster tab lists it: most popular in the region first. */
const roster: readonly LabWorkerRow[] = ask(
  engine.query('match.labWorkers', { scope: 'mine', regionId }, VIEWER),
  'match.labWorkers',
).rows.filter((row) => row.available && row.style !== 'nonWrestler');

function matchKey(name: string): ContentKey {
  const type = catalog.matchTypes.find((option) => option.name === name);
  if (type === undefined) throw new Error(`No match type named ${name}.`);
  return type.key;
}

function angleKey(name: string): ContentKey {
  const type = catalog.angleTypes.find((option) => option.name === name);
  if (type === undefined) throw new Error(`No talking segment type named ${name}.`);
  return type.key;
}

function person(index: number): LabWorkerRow {
  const row = roster[index];
  if (row === undefined) throw new Error(`The roster has no one at ${String(index)}.`);
  return row;
}

/** A singles, tag or talking segment in the lab's default show unless told otherwise. */
function args(
  typeName: string,
  sides: readonly (readonly LabWorkerRow[])[],
  overrides: Partial<PreviewArgs> = {},
): PreviewArgs {
  const isAngle = catalog.angleTypes.some((option) => option.name === typeName);
  return {
    kind: isAngle ? 'angle' : 'match',
    typeKey: isAngle ? angleKey(typeName) : matchKey(typeName),
    sides: sides.map((side) => side.map((row) => row.personId)),
    slotRole: options.defaults.slotRole,
    importance: options.defaults.importance,
    regionId,
    televised: options.defaults.televised,
    previewSeed: 1,
    ...overrides,
  };
}

function preview(previewArgs: PreviewArgs): PreviewResult {
  return ask(engine.query('match.preview', previewArgs, VIEWER), 'match.preview');
}

function batch(previewArgs: PreviewArgs): PreviewBatchResult {
  return ask(
    engine.query('match.previewBatch', { ...previewArgs, runs: BATCH_RUNS }, VIEWER),
    'match.previewBatch',
  );
}

/** Every Why? one Run offers, by the name its button carries. */
function panelsOf(result: PreviewResult): ReadonlyMap<string, TraceNode> {
  const panels = new Map<string, TraceNode>([
    ['Score', result.score.trace],
    ['Stars', result.stars.trace],
    ['Crowd', result.crowd.trace],
    ['Crowd expectation', result.expectation.trace],
    ['Star power', result.starPower.trace],
    ['Duration class', result.slot.durationTrace.trace],
    ['Slot weight', result.slot.weightTrace.trace],
  ]);
  if (result.workRate !== null) panels.set('Work rate', result.workRate.trace);
  if (result.talk !== null) panels.set('Talk', result.talk.trace);
  for (const line of result.workers) {
    if (line.inRing !== null) panels.set(`${line.name}'s in-ring`, line.inRing.trace);
    if (line.talk !== null) panels.set(`${line.name}'s talk`, line.talk.trace);
    panels.set(`${line.name}'s entertainment`, line.entertainment.trace);
    panels.set(`${line.name}'s popularity`, line.popularity.trace);
    panels.set(`${line.name}'s momentum`, line.momentum.trace);
    if (line.stamina !== null) {
      panels.set(`${line.name}'s stamina penalty`, line.stamina.penalty.trace);
    }
  }
  return panels;
}

/** Reads every panel of a Run in the player's words and fails on the first bad line. */
function expectReadablePanels(result: PreviewResult): void {
  for (const [name, trace] of panelsOf(result)) {
    const text = traceToText(trace);
    for (const line of text.split('\n')) {
      expect(line, `${name}: ${line}`).not.toMatch(BROKEN_TEXT);
      expect(line, `${name}: ${line}`).not.toMatch(RAW_CODE);
      expect(line, `${name}: ${line}`).not.toMatch(MINUTES);
      expect(line, `${name}: ${line}`).not.toMatch(RUNNING_TIME_WORDS);
    }
  }
}

/** Every number a Run shows, as numbers. */
function expectInRange(result: PreviewResult): void {
  expect(result.score.value).toBeGreaterThanOrEqual(0);
  expect(result.score.value).toBeLessThanOrEqual(100);
  expect(result.stars.value).toBeGreaterThanOrEqual(0);
  expect(result.stars.value).toBeLessThanOrEqual(5);
  expect(Number.isInteger(result.stars.value * 4)).toBe(true);
  for (const value of [result.crowd.value, result.expectation.value, result.starPower.value]) {
    expect(Number.isFinite(value)).toBe(true);
  }
}

describe('the Match lab on a new default-world game', () => {
  it('opens on a televised Regular midcard singles in Altura’s home region', () => {
    expect(options.available).toBe(true);
    expect(options.promotion?.name).toBe(PLAYER_PROMOTION_NAME);
    expect(options.defaults).toMatchObject({
      kind: 'match',
      slotRole: 'midcard',
      importance: 'regular',
      televised: true,
      regionId: options.promotion?.homeRegionId,
    });
    expect(options.defaults.typeKey).toBe(matchKey('Singles'));
    const slot = ask(
      engine.query(
        'match.slotInfo',
        { slotRole: 'midcard', kind: 'match', typeKey: matchKey('Singles') },
        VIEWER,
      ),
      'match.slotInfo',
    );
    expect(slot.durationLabel).toBe('Standard');
    expect(slot.weight).toBe(1);
    expect(roster.length).toBeGreaterThan(8);
  });

  it('gives a singles of the top two a score, stars, work rate and crowd with readable Why?s', () => {
    const result = preview(args('Singles', [[person(0)], [person(1)]]));
    expectInRange(result);
    expect(result.workRate).not.toBeNull();
    expect(result.warnings).toEqual([]);
    expectReadablePanels(result);

    const stars = traceToText(result.stars.trace);
    expect(stars).toContain('Midcard (standard)');
    expect(stars).toContain('Midcard (standard): at most 4.75 stars');
    expect(stars).toContain('Nearest quarter star');
    expect(stars).toContain('match.stars.pointsPerStar');

    const score = traceToText(result.score.trace);
    expect(score).toMatch(/Work rate × [\d.]+/);
    expect(score).toMatch(/Crowd × [\d.]+/);
    expect(score).toContain('Midcard (standard)');
    expect(score).toContain('Score bonus');

    const crowd = traceToText(result.crowd.trace);
    expect(crowd).toContain('Delivered');
    expect(crowd).toMatch(/expectation/);
    expect(crowd).toContain('match.crowd.varianceSd');

    const workRate = traceToText(result.workRate?.trace ?? result.score.trace);
    for (const row of [person(0), person(1)]) {
      expect(workRate).toMatch(new RegExp(`stamina check (passed|failed) for ${row.name}`));
    }
    expect(workRate).toMatch(/psychology \d+/);
    expect(workRate).toContain('match.workRate.spread.standard');
    expect(workRate).toContain('Night-to-night variance');

    const duration = traceToText(result.slot.durationTrace.trace);
    expect(duration).toContain("Midcard's duration class: Standard");
  });

  it('makes the main event Long at ×1.75 with one stamina line per worker', () => {
    const result = preview(
      args('Singles', [[person(0)], [person(1)]], { slotRole: 'mainEvent' satisfies SlotRole }),
    );
    expect(result.slot.durationClass).toBe('long');
    expect(result.slot.weight).toBe(1.75);
    const workRate = traceToText(result.workRate?.trace ?? result.score.trace);
    for (const row of [person(0), person(1)]) {
      const lines = workRate
        .split('\n')
        .filter((line) => new RegExp(`stamina check (passed|failed) for ${row.name}`).test(line));
      expect(lines.length).toBeGreaterThan(0);
    }
    expect(workRate).toContain('match.workRate.spread.long');
    expectReadablePanels(result);
  });

  it('gives the same numbers for the same seed and new ones for the next', () => {
    const setup = args('Singles', [[person(0)], [person(1)]]);
    const first = preview(setup);
    expect(preview(setup)).toEqual(first);
    const next = preview({ ...setup, previewSeed: 2 });
    expect(next.previewSeed).toBe(2);
    expect(next.expectation.value).toBe(first.expectation.value);
  });

  it('rates a tag match, a talking segment and a broken singles without refusing', () => {
    const tag = preview(
      args('Tag Team', [
        [person(0), person(1)],
        [person(2), person(3)],
      ]),
    );
    expectInRange(tag);
    expect(tag.warnings).toEqual([]);
    expect(tag.workers.every((line) => line.stamina !== null)).toBe(true);
    expectReadablePanels(tag);

    const promo = preview(args('Promo', [[person(0)]]));
    expectInRange(promo);
    expect(promo.workRate).toBeNull();
    expect(promo.talk).not.toBeNull();
    expectReadablePanels(promo);

    const threeSides = preview(args('Singles', [[person(0)], [person(1)], [person(2)]]));
    expectInRange(threeSides);
    expect(threeSides.warnings.map((warning) => warning.message)).toContain(
      'Three sides in a Singles match: it takes 2',
    );
    expectReadablePanels(threeSides);
  });

  it(
    'reads every Why? of every slot role in the player’s words',
    () => {
      for (const slotRole of SLOT_ROLES) {
        expectReadablePanels(preview(args('Singles', [[person(0)], [person(1)]], { slotRole })));
        expectReadablePanels(preview(args('Promo', [[person(2)]], { slotRole })));
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});

/**
 * The first tuning pass (docs/design/match-rating.md). The numbers move when the default world or
 * the tunables do; the checks are the ones the design asks for, not exact values.
 */
describe('the first tuning pass with Run x100', () => {
  it('puts two average midcarders in a standard singles at about 2.5 to 3.25 stars', () => {
    // Altura's midcarders by push, most popular first; the two in the middle are the average pair.
    const list = ask(engine.query('workers.list', {}, VIEWER), 'workers.list');
    const midcard = new Set(
      list.rows.filter((row) => row.push === 'midCard').map((row) => row.personId),
    );
    const midcarders = roster.filter((row) => midcard.has(row.personId));
    expect(midcarders.length).toBeGreaterThan(3);
    const middle = Math.floor(midcarders.length / 2) - 1;
    const pair = midcarders.slice(middle, middle + 2).map((row) => [row]);
    const result = batch(args('Singles', pair));
    expect(result.stars.mean).toBeGreaterThanOrEqual(2.5);
    expect(result.stars.mean).toBeLessThanOrEqual(3.25);
  });

  it('expects more of the two most popular in the main event than in the opener', () => {
    const top = [[person(0)], [person(1)]];
    const opener = batch(args('Singles', top, { slotRole: 'opener' }));
    const mainEvent = batch(args('Singles', top, { slotRole: 'mainEvent' }));
    expect(mainEvent.expectation).toBeGreaterThan(opener.expectation);

    // The crowd only beats the opener's when they deliver more: the surprise is what they
    // delivered against a bigger expectation.
    const openerRun = preview(args('Singles', top, { slotRole: 'opener' }));
    const mainRun = preview(args('Singles', top, { slotRole: 'mainEvent' }));
    const delivered = (run: PreviewResult): number => {
      const node = run.crowd.trace.children?.find((child) => child.label.startsWith('Delivered'));
      if (node === undefined) throw new Error('No delivered line in the crowd.');
      return typeof node.value === 'number' ? node.value : Number.NaN;
    };
    if (mainRun.crowd.value > openerRun.crowd.value) {
      expect(delivered(mainRun)).toBeGreaterThan(delivered(openerRun));
    }
  });

  it(
    'never lets a battle royal average above the best singles of the same people',
    () => {
      const people = roster.slice(0, 8);
      const royal = batch(
        args(
          'Battle Royal',
          people.map((row) => [row]),
        ),
      );
      let bestSingles = 0;
      for (let first = 0; first < people.length; first += 1) {
        for (let second = first + 1; second < people.length; second += 1) {
          const pair = [[person(first)], [person(second)]];
          bestSingles = Math.max(bestSingles, batch(args('Singles', pair)).score.mean);
        }
      }
      expect(royal.score.mean).toBeLessThanOrEqual(bestSingles);
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'keeps every run of 100 inside 0–100 and 0–5 stars',
    () => {
      const setups: PreviewArgs[] = [];
      for (const slotRole of SLOT_ROLES) {
        setups.push(args('Singles', [[person(0)], [person(1)]], { slotRole }));
        setups.push(
          args('Singles', [[person(roster.length - 2)], [person(roster.length - 1)]], {
            slotRole,
          }),
        );
        setups.push(args('Promo', [[person(0)]], { slotRole }));
      }
      for (const setup of setups) {
        const result = batch(setup);
        expect(result.score.min).toBeGreaterThanOrEqual(0);
        expect(result.score.max).toBeLessThanOrEqual(100);
        expect(result.stars.min).toBeGreaterThanOrEqual(0);
        expect(result.stars.max).toBeLessThanOrEqual(5);
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});

describe('a save from before match types', () => {
  it('reports the lab unavailable and refuses a preview without crashing', () => {
    // The golden save's World with its catalogs taken out, as a save from before them stored it.
    const stored = tinySaveDocument();
    const world = documentToWorld(stored, TABLES);
    const old = createEngine({
      state: initialEngineState({ ...world, meta: { ...world.meta, catalogs: {} } }),
      systems: defaultSystems,
    });
    const oldOptions = ask(old.query('match.labOptions', {}, OMNISCIENT_VIEWER), 'labOptions');
    expect(oldOptions.available).toBe(false);
    const oldCatalog = ask(old.query('match.catalog', {}, OMNISCIENT_VIEWER), 'match.catalog');
    expect(oldCatalog.available).toBe(false);
    expect(oldCatalog.matchTypes).toEqual([]);
  });
});
