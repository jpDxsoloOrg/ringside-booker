import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMITTED_BLOCKLIST_PATH,
  findBlockedName,
  matchesEntry,
  parseBlocklist,
  readBlocklistFile,
  type Blocklist,
} from '../src/blocklist';
import { formatIssue, type ValidationIssue } from '../src/issues';
import { EXIT_INVALID, EXIT_USAGE, runValidateWorld } from '../src/run';
import { ageSanity } from '../src/rules/ageSanity';
import { createBlocklistRule } from '../src/rules/blocklist';
import { championEligibility } from '../src/rules/championEligibility';
import { employmentDates } from '../src/rules/employmentDates';
import { freeAgents } from '../src/rules/freeAgents';
import { geography } from '../src/rules/geography';
import { contentRules, runRules } from '../src/rules/index';
import { promotionStaffing } from '../src/rules/promotionStaffing';
import { reignChronology } from '../src/rules/reignChronology';
import { uniqueNames } from '../src/rules/uniqueNames';
import {
  captureIo,
  checkRule,
  checkRuleOnMergedRecords,
  cloneRecord,
  copyFixtureRepo,
  editRecords,
  loadForRules,
  loaderRejects,
  patchRecord,
  readCheckWorld,
  readMiniWorld,
  REPO_ROOT,
} from './helpers';

const MINI_ROOTS = ['mini-world'];
const CHECK_ROOTS = ['check-world'];

function testBlocklist(...names: string[]): Blocklist {
  return { entries: parseBlocklist(names.join('\n'), 'test-blocklist.txt') };
}

function errorsOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

function warningsOf(issues: readonly ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === 'warning');
}

describe('the valid fixture world', () => {
  it('passes every rule with no warnings', async () => {
    const { world, content } = loadForRules(await readCheckWorld(), CHECK_ROOTS);
    const issues = runRules(
      contentRules({ blocklist: testBlocklist('Velvet Hammerlock') }),
      world,
      content,
    );
    expect(issues.map(formatIssue)).toEqual([]);
  });
});

describe('promotion-staffing', () => {
  it('fails a promotion with no referee or announcer and warns below six wrestlers', async () => {
    const issues = checkRule(promotionStaffing, await readMiniWorld(), MINI_ROOTS);
    const hcw = issues.filter((issue) => issue.recordKey === 'harbour-city-wrestling');
    expect(errorsOf(hcw).map((issue) => issue.message)).toEqual([
      'Active promotion harbour-city-wrestling has no referee under contract on 2026-01-05',
      'Active promotion harbour-city-wrestling has no announcer under contract on 2026-01-05',
    ]);
    expect(warningsOf(hcw)).toHaveLength(1);
    expect(hcw[0]).toMatchObject({
      code: 'promotion-staffing',
      packId: 'mini-world',
      file: 'promotions.json',
      path: ['promotion', 'harbour-city-wrestling'],
    });
  });

  it('fails the valid world once its only referee is gone', async () => {
    const packs = editRecords(await readCheckWorld(), 'check-world', 'employment', (records) =>
      records.filter((record) => record['role'] !== 'referee'),
    );
    const issues = checkRule(promotionStaffing, packs, CHECK_ROOTS);
    expect(errorsOf(issues).map((issue) => issue.message)).toEqual([
      'Active promotion fenland-grappling has no referee under contract on 2026-01-05',
    ]);
  });

  it('leaves closed promotions alone', async () => {
    const packs = editRecords(await readMiniWorld(), 'mini-world', 'promotion', (records) =>
      records.map((record) => ({ ...record, status: 'closed' })),
    );
    expect(checkRule(promotionStaffing, packs, MINI_ROOTS)).toEqual([]);
  });
});

describe('champion-eligibility', () => {
  it('fails a champion who is employed by another promotion', async () => {
    const packs = editRecords(
      await readMiniWorld(),
      'mini-world',
      'titleReign',
      patchRecord('hcw-heavyweight-jack-1', { holderPersonKeys: ['otto-brand'] }),
    );
    const issues = checkRule(championEligibility, packs, MINI_ROOTS);
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'champion-eligibility',
        recordKey: 'hcw-heavyweight-jack-1',
        path: ['titleReign', 'hcw-heavyweight-jack-1', 'holderPersonKeys', 0],
        message:
          'Champion otto-brand has no contract with harbour-city-wrestling, the promotion of title hcw-heavyweight, on 2026-01-05',
      }),
    ]);
  });

  it('passes the fixture champion as authored', async () => {
    expect(checkRule(championEligibility, await readMiniWorld(), MINI_ROOTS)).toEqual([]);
  });

  it('fails a champion outside the division gender or weight', async () => {
    const female = editRecords(
      await readMiniWorld(),
      'mini-world',
      'title',
      patchRecord('hcw-heavyweight', {
        division: { gender: 'female', minWeightKg: null, maxWeightKg: null },
      }),
    );
    expect(
      checkRule(championEligibility, female, MINI_ROOTS).map((issue) => issue.message),
    ).toEqual([
      'Champion jack-marlow is male, but the division is female only for title hcw-heavyweight',
    ]);
    const light = editRecords(
      await readMiniWorld(),
      'mini-world',
      'title',
      patchRecord('hcw-heavyweight', {
        division: { gender: 'open', minWeightKg: null, maxWeightKg: 90 },
      }),
    );
    expect(checkRule(championEligibility, light, MINI_ROOTS).map((issue) => issue.message)).toEqual(
      [
        'Champion jack-marlow weighs 95 kg, over the division limit of 90 kg for title hcw-heavyweight',
      ],
    );
  });

  it('checks the holder count and the team of a tag reign', async () => {
    const baseline = await readMiniWorld();
    let packs = editRecords(
      baseline,
      'mini-world',
      'title',
      patchRecord('hcw-heavyweight', { holderCount: 2 }),
    );
    expect(
      checkRuleOnMergedRecords(championEligibility, packs, baseline, MINI_ROOTS).map(
        (issue) => issue.message,
      ),
    ).toEqual([
      'Title hcw-heavyweight is held by 2 at a time, but this reign names 1',
      'A reign with 2 holders must name the team that holds it',
    ]);

    packs = editRecords(
      packs,
      'mini-world',
      'titleReign',
      patchRecord('hcw-heavyweight-jack-1', {
        holderPersonKeys: ['jack-marlow', 'nina-vale'],
        teamKey: 'harbour-pair',
      }),
    );
    packs = editRecords(packs, 'mini-world', 'team', () => [
      {
        key: 'harbour-pair',
        kind: 'tag',
        name: 'Harbour Pair',
        memberKeys: ['jack-marlow', 'otto-brand'],
        formedOn: '2024-01-01',
      },
    ]);
    expect(
      checkRuleOnMergedRecords(championEligibility, packs, baseline, MINI_ROOTS).map(
        (issue) => issue.message,
      ),
    ).toEqual([
      'Team harbour-pair is jack-marlow, otto-brand, but the holders are jack-marlow, nina-vale',
    ]);
  });
});

describe('reign-chronology', () => {
  it('fails overlapping reigns of one title', async () => {
    const baseline = await readMiniWorld();
    const packs = editRecords(
      baseline,
      'mini-world',
      'titleReign',
      cloneRecord('hcw-heavyweight-jack-1', {
        key: 'hcw-heavyweight-nina-1',
        holderPersonKeys: ['nina-vale'],
        wonOn: '2025-01-04',
        lostOn: '2025-10-01',
        endReason: 'lost',
      }),
    );
    // The loader's integrity pass refuses overlapping reigns too; the rule is checked on its own.
    expect(loaderRejects(packs, MINI_ROOTS)).toBe(true);
    const issues = checkRuleOnMergedRecords(reignChronology, packs, baseline, MINI_ROOTS);
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'reign-chronology',
        recordKey: 'hcw-heavyweight-jack-1',
        path: ['titleReign', 'hcw-heavyweight-jack-1', 'wonOn'],
        message:
          'Reign hcw-heavyweight-jack-1 of title hcw-heavyweight starts on 2025-09-13, while reign hcw-heavyweight-nina-1 is still running (until 2025-10-01)',
      }),
    ]);
  });

  it('allows one reign to end on the day the next begins', async () => {
    const packs = editRecords(
      await readMiniWorld(),
      'mini-world',
      'titleReign',
      cloneRecord('hcw-heavyweight-jack-1', {
        key: 'hcw-heavyweight-nina-1',
        holderPersonKeys: ['nina-vale'],
        wonOn: '2025-01-04',
        lostOn: '2025-09-13',
        endReason: 'lost',
      }),
    );
    expect(checkRule(reignChronology, packs, MINI_ROOTS)).toEqual([]);
  });

  it('fails a second open reign, a same-day reign and a reign that ends after the start', async () => {
    const baseline = await readMiniWorld();
    const packs = editRecords(baseline, 'mini-world', 'titleReign', (records) => [
      ...records,
      {
        ...records[0],
        key: 'hcw-heavyweight-otto-1',
        holderPersonKeys: ['otto-brand'],
        wonOn: '2024-01-01',
        lostOn: '2024-01-01',
        endReason: 'lost',
      },
      {
        ...records[0],
        key: 'hcw-heavyweight-sam-1',
        holderPersonKeys: ['sam-reed'],
        wonOn: '2025-12-01',
      },
      {
        ...records[0],
        key: 'hcw-heavyweight-nina-1',
        holderPersonKeys: ['nina-vale'],
        wonOn: '2023-01-01',
        lostOn: '2026-02-01',
        endReason: 'lost',
      },
    ]);
    const messages = checkRuleOnMergedRecords(reignChronology, packs, baseline, MINI_ROOTS).map(
      (issue) => issue.message,
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        'Reign hcw-heavyweight-otto-1 is lost on 2024-01-01, which is not after it was won on 2024-01-01',
        'Reign hcw-heavyweight-nina-1 ends on 2026-02-01, after the world starts on 2026-01-05; a reign still running on the start date must be left open (lostOn null)',
        'Title hcw-heavyweight already has an open reign (hcw-heavyweight-jack-1); only one reign can be current',
      ]),
    );
  });
});

describe('employment-dates', () => {
  it('fails a contract that starts after the world does', async () => {
    const baseline = await readMiniWorld();
    const packs = editRecords(
      baseline,
      'mini-world',
      'employment',
      patchRecord('sam-reed-rcw', { startsOn: '2026-02-01' }),
    );
    const issues = checkRuleOnMergedRecords(employmentDates, packs, baseline, MINI_ROOTS);
    expect(errorsOf(issues)).toEqual([
      expect.objectContaining({
        recordKey: 'sam-reed-rcw',
        path: ['employment', 'sam-reed-rcw', 'startsOn'],
        message: 'Contract sam-reed-rcw starts on 2026-02-01, after the world starts on 2026-01-05',
      }),
    ]);
  });

  it('fails a contract that has already ended', async () => {
    const packs = editRecords(
      await readMiniWorld(),
      'mini-world',
      'employment',
      patchRecord('sam-reed-rcw', { endsOn: '2025-12-01' }),
    );
    expect(
      errorsOf(checkRule(employmentDates, packs, MINI_ROOTS)).map((issue) => issue.message),
    ).toEqual([
      'Contract sam-reed-rcw ends on 2025-12-01, before the world starts on 2026-01-05; leave expired contracts out of the pack',
    ]);
  });

  it('fails two exclusive contracts for one person', async () => {
    const baseline = await readMiniWorld();
    const packs = editRecords(
      baseline,
      'mini-world',
      'employment',
      cloneRecord('sam-reed-rcw', {
        key: 'sam-reed-hcw',
        promotionKey: 'harbour-city-wrestling',
        ringName: 'Sam Reed',
      }),
    );
    const issues = checkRuleOnMergedRecords(employmentDates, packs, baseline, MINI_ROOTS);
    expect(errorsOf(issues).map((issue) => issue.message)).toEqual([
      'sam-reed already has an exclusive contract (sam-reed-hcw) running on 2026-01-05',
    ]);
  });

  it('warns when too many contracts end in one 30-day window', async () => {
    const warnings = warningsOf(checkRule(employmentDates, await readMiniWorld(), MINI_ROOTS));
    expect(warnings.map((issue) => issue.message)).toEqual([
      '4 of 4 contracts (100%) end between 2027-03-01 and 2027-03-01; spread expiries so no 30-day window holds more than 25% of them',
    ]);
    expect(checkRule(employmentDates, await readCheckWorld(), CHECK_ROOTS)).toEqual([]);
  });
});

describe('unique-names', () => {
  it('fails two people with the same legal name, ignoring case and accents', async () => {
    const packs = editRecords(
      await readMiniWorld(),
      'mini-world',
      'person',
      patchRecord('nina-vale', { givenName: 'JÁCK', familyName: 'marlow' }),
    );
    expect(errorsOf(checkRule(uniqueNames, packs, MINI_ROOTS))).toEqual([
      expect.objectContaining({
        code: 'unique-names',
        recordKey: 'nina-vale',
        path: ['person', 'nina-vale', 'givenName'],
        message: 'nina-vale has the legal name "JÁCK marlow", already used by jack-marlow',
      }),
    ]);
  });

  it('fails a ring name used twice in one promotion and warns when it is reused elsewhere', async () => {
    const inPromotion = editRecords(
      await readMiniWorld(),
      'mini-world',
      'employment',
      patchRecord('nina-vale-hcw', { ringName: 'The Harbour Hammer' }),
    );
    expect(
      errorsOf(checkRule(uniqueNames, inPromotion, MINI_ROOTS)).map((issue) => issue.message),
    ).toEqual([
      'Ring name "The Harbour Hammer" is already used in harbour-city-wrestling by jack-marlow (jack-marlow-hcw)',
    ]);

    const acrossWorld = editRecords(
      await readMiniWorld(),
      'mini-world',
      'person',
      patchRecord('otto-brand', { defaultRingName: 'Jack Marlow' }),
    );
    const issues = checkRule(uniqueNames, acrossWorld, MINI_ROOTS);
    expect(errorsOf(issues)).toEqual([]);
    expect(warningsOf(issues).map((issue) => issue.recordKey)).toEqual([
      'jack-marlow',
      'otto-brand',
    ]);
  });
});

describe('geography', () => {
  it('fails countries whose regions do not add up or that have no name mix', async () => {
    const issues = checkRule(geography, await readMiniWorld(), MINI_ROOTS);
    expect(issues.map((issue) => issue.message)).toEqual([
      'The regions of cormere (2) add up to 2800000 people, but the country has 8200000, more than 5% apart',
      'Country cormere has no countryNameMix record, so people born there cannot be named',
      'The regions of vellmark (1) add up to 2300000 people, but the country has 5100000, more than 5% apart',
      'Country vellmark has no countryNameMix record, so people born there cannot be named',
    ]);
    expect(issues[0]).toMatchObject({ packId: 'mini-base', file: 'geography/countries.json' });
  });

  it('fails a country with no regions', async () => {
    const packs = editRecords(
      await readCheckWorld(),
      'check-base',
      'country',
      cloneRecord('lowmarch', { key: 'highmarch', name: 'Highmarch', code: 'HGM' }),
    );
    const messages = checkRule(geography, packs, CHECK_ROOTS).map((issue) => issue.message);
    expect(messages).toEqual([
      'Country highmarch has no regions',
      'Country highmarch has no countryNameMix record, so people born there cannot be named',
    ]);
  });
});

describe('free-agents', () => {
  it('warns when fewer than 30 wrestlers are unsigned', async () => {
    expect(checkRule(freeAgents, await readMiniWorld(), MINI_ROOTS)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'free-agents',
        message:
          'Only 0 active wrestlers are without a contract on 2026-01-05; at least 30 are needed so a newly founded promotion can hire',
      }),
    ]);
  });

  it('passes the fixture world, which has exactly 30', async () => {
    expect(checkRule(freeAgents, await readCheckWorld(), CHECK_ROOTS)).toEqual([]);
  });
});

describe('age-sanity', () => {
  it('fails people outside 16-80 and debuts before 15', async () => {
    const packs = editRecords(await readMiniWorld(), 'mini-world', 'person', (records) =>
      records.map((record) => {
        if (record['key'] === 'sam-reed') {
          return { ...record, birthDate: '2011-03-01', debutDate: null };
        }
        if (record['key'] === 'otto-brand') {
          return { ...record, birthDate: '1940-01-01', debutDate: '1960-01-01' };
        }
        if (record['key'] === 'nina-vale') {
          return { ...record, birthDate: '1998-07-30', debutDate: '2013-01-30' };
        }
        return record;
      }),
    );
    expect(checkRule(ageSanity, packs, MINI_ROOTS).map((issue) => issue.message)).toEqual([
      'nina-vale debuts on 2013-01-30, before their 15th birthday',
      'otto-brand is 86 on 2026-01-05; everyone must be 16-80',
      'sam-reed is 14 on 2026-01-05; everyone must be 16-80',
    ]);
  });
});

describe('blocklist', () => {
  it('fails a blocklisted ring name and names the record key and field', async () => {
    const packs = editRecords(
      await readMiniWorld(),
      'mini-world',
      'employment',
      patchRecord('nina-vale-hcw', { ringName: 'Velvet Hammerlock' }),
    );
    const issues = checkRule(
      createBlocklistRule(testBlocklist('Velvet Hammerlock')),
      packs,
      MINI_ROOTS,
    );
    expect(issues.map(formatIssue)).toEqual([
      'error blocklist mini-world/employments.json employment.nina-vale-hcw.ringName: Ring name "Velvet Hammerlock" matches the real name "Velvet Hammerlock" (test-blocklist.txt:1); rename it',
    ]);
  });

  it('checks legal names, promotion names and short names, and title names', async () => {
    const packs = editRecords(
      editRecords(
        editRecords(
          await readMiniWorld(),
          'mini-world',
          'person',
          patchRecord('otto-brand', { givenName: 'Otto', familyName: 'Duskmoor' }),
        ),
        'mini-world',
        'promotion',
        patchRecord('river-city-wrestling', { shortName: 'GPG', name: 'The Gravel Pit Grapplers' }),
      ),
      'mini-world',
      'title',
      patchRecord('hcw-heavyweight', { name: 'Gravel Pit Grapplers Title' }),
    );
    const blocklist = testBlocklist('Gravel Pit Grapplers', 'GPG', 'Otto Duskmoor');
    const paths = checkRule(createBlocklistRule(blocklist), packs, MINI_ROOTS).map((issue) =>
      issue.path.join('.'),
    );
    expect(paths).toEqual([
      'person.otto-brand.givenName',
      'promotion.river-city-wrestling.name',
      'promotion.river-city-wrestling.shortName',
      'title.hcw-heavyweight.name',
    ]);
  });

  it('matches names that differ only in case, accents or punctuation', () => {
    const blocklist = testBlocklist('Velvet Hammerlock', 'A.J. Example', 'Smack Down', 'Duskmoor');
    for (const variant of [
      'velvet hammerlock',
      'VELVET HAMMERLOCK',
      'Vélvet Hämmerlock',
      'Velvet-Hammerlock',
      'Velvet Hammerlock!',
      '"Velvet" Hammerlock',
      'The Velvet Hammerlock Show',
      'AJ Example',
      'A J Example',
      'aj example',
      'SmackDown',
      'Dúskmoor',
      'DUSK-MOOR',
    ]) {
      expect(findBlockedName(variant, blocklist)?.name, variant).toBeDefined();
    }
  });

  it('matches a one-word entry only as the whole name', () => {
    const [entry] = parseBlocklist('Duskmoor', 'test.txt');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    expect(matchesEntry('Duskmoor', entry)).toBe(true);
    expect(matchesEntry('Duskmoor Arena', entry)).toBe(false);
    expect(matchesEntry('Duskmoorland', entry)).toBe(false);
  });

  it('skips blank lines and # comments in the file format', () => {
    const entries = parseBlocklist('# heading\n\n  Velvet Hammerlock  \n#Duskmoor\n', 'test.txt');
    expect(entries.map((entry) => [entry.name, entry.line])).toEqual([['Velvet Hammerlock', 3]]);
  });

  it('loads the committed list, which is not empty', async () => {
    const entries = await readBlocklistFile(
      join(REPO_ROOT, COMMITTED_BLOCKLIST_PATH),
      COMMITTED_BLOCKLIST_PATH,
    );
    expect(entries.length).toBeGreaterThan(100);
  });

  it('exits 2 when the committed real-names.txt is empty', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      await writeFile(join(root, COMMITTED_BLOCKLIST_PATH), '# nothing here yet\n\n', 'utf8');
      const io = captureIo(root);
      expect(await runValidateWorld(['content/worlds/check-world'], io)).toBe(EXIT_USAGE);
      expect(io.err()).toContain('has no names in it');
      expect(io.out()).toBe('');
    } finally {
      await cleanUp();
    }
  });

  it('exits 2 when the committed real-names.txt is missing, even with --blocklist', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      const extra = join(root, 'extra.txt');
      await writeFile(extra, await readFile(join(root, COMMITTED_BLOCKLIST_PATH), 'utf8'), 'utf8');
      await rm(join(root, COMMITTED_BLOCKLIST_PATH));
      const io = captureIo(root);
      expect(
        await runValidateWorld(['content/worlds/check-world', '--blocklist', 'extra.txt'], io),
      ).toBe(EXIT_USAGE);
      expect(io.err()).toContain('Cannot read the blocklist content/blocklist/real-names.txt');
    } finally {
      await cleanUp();
    }
  });

  it('fails a run whose content hits the committed list and prints the record key and field', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      const promotionsFile = join(root, 'content/worlds/check-world/promotions.json');
      const text = await readFile(promotionsFile, 'utf8');
      await writeFile(
        promotionsFile,
        text.replace('Fenland Grappling Federation', 'Gravel Pit Grapplers'),
        'utf8',
      );
      const io = captureIo(root);
      expect(await runValidateWorld(['content/worlds/check-world'], io)).toBe(EXIT_INVALID);
      expect(io.out()).toContain(
        'error blocklist check-world/promotions.json promotion.fenland-grappling.name: Promotion name "Gravel Pit Grapplers" matches the real name "Gravel Pit Grapplers" (content/blocklist/real-names.txt:3); rename it',
      );
    } finally {
      await cleanUp();
    }
  });

  it('adds a --blocklist file on top of the committed list', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      await writeFile(join(root, 'extra.txt'), 'Fenland Grappling Federation\n', 'utf8');
      const io = captureIo(root);
      expect(
        await runValidateWorld(['content/worlds/check-world', '--blocklist', 'extra.txt'], io),
      ).toBe(EXIT_INVALID);
      expect(io.out()).toContain('(extra.txt:1)');
    } finally {
      await cleanUp();
    }
  });
});
