// Every "Why?" on the Workers list and the profile, checked against the shipped default world in
// the words the panel shows: readable labels, the settings named by key, no raw codes, no broken
// numbers. It also checks what a rival's profile keeps private.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createEngine,
  createNewGame,
  defaultSystems,
  packManifestSchema,
  PUSH_LABELS,
  RATING_ROLE_LABELS,
  RECORD_KINDS,
  WEIGHT_CLASS_LABELS,
  WORKER_EXPLAIN_METRICS,
} from '@ringside/engine';
import type {
  Engine,
  PersonId,
  RawPack,
  RecordKind,
  TraceNode,
  Viewer,
  WorkerList,
  WorkerProfile,
  WorkerRow,
} from '@ringside/engine';
import { traceToText } from '@/components/Trace/traceToText';

// A path, not a URL: under jsdom the URL class is not the one node:fs accepts.
const CONTENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../../content');

const PLAYER_ID = 'local-player';
const PLAYER_PROMOTION_KEY = 'pro-flagship';
const PLAYER_PROMOTION_NAME = 'Altura Wrestling Entertainment';
const RIVAL_PROMOTION_NAME = 'Hibari Pro Wrestling';
const DEFAULT_WORLD_PEOPLE = 286;
const DEFAULT_WORLD_FREE_AGENTS = 44;

/** Profiles carry every level of the popularity roll-up, so the audit reads every Nth person. */
const SAMPLE_EVERY = 8;
/** The popularity tree is the big one (every country on the map), so fewer people are read in full. */
const POPULARITY_SAMPLE_EVERY = 4;
const AUDIT_TIMEOUT_MS = 60_000;

/** What a number or a name that failed to format leaves behind. */
const BROKEN_TEXT = /undefined|NaN|Infinity|\[object /;
/** A camelCase code, such as `mainEvent`, outside a dotted setting key. */
const RAW_CODE = /(?<![.\w])[a-z]+[A-Z]\w*(?![.\w])/;

const VIEWER: Viewer = { kind: 'controller', controller: { kind: 'human', playerId: PLAYER_ID } };

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

/** A new game on the default world, playing the flagship promotion, before any day has run. */
function startDefaultGame(): Engine {
  const game = createNewGame([readContentPack('base'), readContentPack('worlds/default')], {
    rootPackId: 'default-world',
    seed: 'workers-why-audit',
    playerId: PLAYER_ID,
    playerName: 'Alex Booker',
    saveName: 'Why audit',
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

function workersList(): WorkerList {
  const answer = engine.query('workers.list', {}, VIEWER);
  if (!answer.ok) {
    throw new Error(`workers.list was refused: ${JSON.stringify(answer.reasons)}`);
  }
  return answer.data;
}

const profiles = new Map<PersonId, WorkerProfile>();

/** A person's profile as the player sees it, asked for once. */
function profileOf(personId: PersonId): WorkerProfile {
  const known = profiles.get(personId);
  if (known !== undefined) return known;
  const profile = askForProfile(personId);
  profiles.set(personId, profile);
  return profile;
}

function askForProfile(personId: PersonId): WorkerProfile {
  const answer = engine.query('workers.profile', { personId }, VIEWER);
  if (!answer.ok) {
    throw new Error(`workers.profile was refused: ${JSON.stringify(answer.reasons)}`);
  }
  return answer.data;
}

function firstRowAt(rows: readonly WorkerRow[], employerName: string): WorkerRow {
  const row = rows.find(
    (candidate) => candidate.employer?.name === employerName && candidate.mainRole === 'wrestler',
  );
  if (row === undefined) {
    throw new Error(`Nobody wrestles for ${employerName} in the default world`);
  }
  return row;
}

/** A breakdown in the panel's words, after the checks every breakdown must pass. */
function checkedText(what: string, trace: TraceNode): string {
  const text = traceToText(trace);
  expect(text, what).not.toMatch(BROKEN_TEXT);
  expect(text, what).not.toMatch(RAW_CODE);
  return text;
}

const list = workersList();
const sampled = list.rows.filter((_row, index) => index % SAMPLE_EVERY === 0);
const popularitySampled = sampled.filter((_row, index) => index % POPULARITY_SAMPLE_EVERY === 0);

describe('the default world behind the Workers screens', () => {
  it('lists everyone and counts the free agents', () => {
    expect(list.rows).toHaveLength(DEFAULT_WORLD_PEOPLE);
    expect(list.total).toBe(DEFAULT_WORLD_PEOPLE);
    expect(list.freeAgents).toBe(DEFAULT_WORLD_FREE_AGENTS);
  });
});

describe('every Why? on a profile, in the words the panel shows', () => {
  it(
    'explains the overall in each role by attribute and weight, naming each weight setting',
    () => {
      for (const row of sampled) {
        const profile = profileOf(row.personId);
        for (const rating of profile.overall.byRole) {
          const what = `${row.ringName}, ${rating.role} overall`;
          const lines = checkedText(what, rating.trace).split('\n');
          expect(lines[0], what).toContain(`${RATING_ROLE_LABELS[rating.role]} rating: `);
          const weighted = lines.filter((line) => line.includes(' × weight '));
          const settings = lines.filter((line) =>
            line.includes(`Game setting · workers.rating.${rating.role}.`),
          );
          expect(weighted.length, what).toBeGreaterThan(0);
          expect(settings, what).toHaveLength(weighted.length);
          expect(
            lines.some((line) => line.includes('Total weight')),
            what,
          ).toBe(true);
        }
      }
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'explains the expected push with the standing, the fan base and the card marks',
    () => {
      for (const row of sampled) {
        const { expectedPush } = profileOf(row.personId);
        if (expectedPush === null) {
          throw new Error('The player runs a promotion, so every profile has an expected push');
        }
        const what = `${row.ringName}, expected push`;
        const text = checkedText(what, expectedPush.trace);
        expect(expectedPush.promotionName).toBe(PLAYER_PROMOTION_NAME);
        expect(text.split('\n')[0], what).toBe(`Expected push: ${PUSH_LABELS[expectedPush.push]}`);
        if (expectedPush.push !== 'none') {
          expect(text, what).toContain(`Standing at ${PLAYER_PROMOTION_NAME}`);
          expect(text, what).toContain('workers.expectedPush.mainEventRatio');
          expect(text, what).toContain('workers.expectedPush.lowerCardRatio');
          expect(text, what).toContain('workers.expectedPush.footprintMinPop');
        }
      }
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'explains the weight class with all four limits',
    () => {
      for (const row of sampled) {
        const { weightClass } = profileOf(row.personId).header;
        const what = `${row.ringName}, weight class`;
        const text = checkedText(what, weightClass.trace);
        expect(text.split('\n')[0], what).toBe(
          `Weight class: ${WEIGHT_CLASS_LABELS[weightClass.value]}`,
        );
        for (const key of ['lightweight', 'cruiserweight', 'lightHeavyweight', 'heavyweight']) {
          expect(text, what).toContain(`workers.weightClass.${key}MaxKg`);
        }
      }
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'explains popularity at every level by population share',
    () => {
      for (const row of popularitySampled) {
        const { popularity } = profileOf(row.personId);
        const worldText = checkedText(`${row.ringName}, world`, popularity.world.trace);
        expect(worldText.split('\n')[0]).toContain('Popularity worldwide: ');
        for (const continent of popularity.continents) {
          const what = `${row.ringName}, ${continent.name}`;
          const continentText = checkedText(what, continent.trace);
          expect(continentText.split('\n')[0], what).toContain(`Popularity in ${continent.name}: `);
          for (const country of continent.countries) {
            const countryWhat = `${row.ringName}, ${country.name}`;
            const countryText = checkedText(countryWhat, country.trace);
            expect(countryText.split('\n')[0], countryWhat).toContain(
              `Popularity in ${country.name}: `,
            );
            const shares = countryText
              .split('\n')
              .filter((line) => line.includes('% of the population'));
            expect(shares, countryWhat).toHaveLength(country.regions.length);
            for (const region of country.regions) {
              expect(countryText, countryWhat).toContain(region.name);
            }
          }
        }
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});

describe('the on-demand Why? behind the list cells', () => {
  it(
    'gives the same breakdown as the profile for the overall and the top popularity',
    () => {
      for (const row of sampled) {
        for (const metric of WORKER_EXPLAIN_METRICS) {
          if (metric !== 'overall' && !popularitySampled.includes(row)) continue;
          const answer = engine.query(
            'workers.explain',
            { personId: row.personId, metric },
            VIEWER,
          );
          if (!answer.ok) {
            throw new Error(`workers.explain was refused: ${JSON.stringify(answer.reasons)}`);
          }
          checkedText(`${row.ringName}, ${metric}`, answer.data.trace);
          if (metric === 'overall') {
            expect(answer.data.value).toBe(row.overall);
            expect(traceToText(answer.data.trace)).toContain('workers.rating.');
          }
          if (metric === 'topPopularity') {
            // Somebody nobody has heard of has no top country: the cell shows a dash and no Why?.
            expect(answer.data.value).toBe(row.topPopularity?.value ?? 0);
          }
        }
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});

describe('what a profile keeps private', () => {
  it('shows a rival worker with their employer and push, but no wage and no morale', () => {
    const profile = profileOf(firstRowAt(list.rows, RIVAL_PROMOTION_NAME).personId);
    const [current] = profile.career.contracts;

    expect(profile.header.employer?.name).toBe(RIVAL_PROMOTION_NAME);
    expect(profile.header.push).not.toBeNull();
    expect(current?.terms).toBeNull();
    expect(current?.morale).toBeNull();
    expect(profile.hidden).toEqual(expect.arrayContaining(['contractTerms', 'morale']));
  });

  it("shows one of the player's own workers with wage and morale", () => {
    const profile = profileOf(firstRowAt(list.rows, PLAYER_PROMOTION_NAME).personId);
    const [current] = profile.career.contracts;

    expect(current?.terms).not.toBeNull();
    expect(current?.morale).not.toBeNull();
    expect(profile.hidden).toEqual([]);
  });

  it('never mentions potential, on any profile', () => {
    for (const row of sampled) {
      expect(JSON.stringify(profileOf(row.personId)).toLowerCase()).not.toContain('potential');
    }
  });
});
