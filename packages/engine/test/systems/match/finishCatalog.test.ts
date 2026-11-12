// The finish catalog (MTCH2-01): the shipped finishes parse, pass the catalog check and keep their
// title and method rules; a broken catalog gives one issue per problem; the readers list finishes
// in catalog order. Design: docs/design/match-finishes.md#catalog
import { describe, expect, it } from 'vitest';
import { parseContentKey } from '../../../src/core/content-key';
import {
  FINISH_CATEGORIES,
  FinishEntrySchema,
  finishesOf,
  finishOf,
  type Catalogs,
  type FinishEntry,
} from '../../../src/model/catalogs';
import { isMatch } from '../../../src/model/entities/segment';
import {
  checkFinishCatalog,
  FINISH_CATALOG_ISSUE_CODES,
} from '../../../src/systems/match/catalog/finishes';
import { TEST_CATALOGS } from '../../support/catalogs';
import { worldBuilder } from '../../support/world-builder';
import { tinyWorld } from '../../support/worlds';

const SHIPPED: readonly FinishEntry[] = Object.values(TEST_CATALOGS.finishes ?? {});

function shipped(key: string): FinishEntry {
  const finish = TEST_CATALOGS.finishes?.[parseContentKey(key)];
  if (finish === undefined) {
    throw new Error(`No shipped finish ${key}`);
  }
  return finish;
}

/** The shipped catalogs with the finishes replaced. */
function withFinishes(entries: readonly FinishEntry[]): Catalogs {
  return {
    ...TEST_CATALOGS,
    finishes: Object.fromEntries(entries.map((entry) => [entry.key, entry])),
  };
}

describe('the shipped finish catalog', () => {
  it('has the ten finishes, each parsing, and checkFinishCatalog finds nothing', () => {
    expect(SHIPPED).toHaveLength(10);
    for (const finish of SHIPPED) {
      expect(FinishEntrySchema.safeParse(finish).success).toBe(true);
    }
    expect(checkFinishCatalog(TEST_CATALOGS)).toEqual([]);
  });

  it('uses every category at least once', () => {
    const categories = new Set(SHIPPED.map((finish) => finish.category));
    expect([...categories].sort()).toEqual([...FINISH_CATEGORIES].sort());
  });

  it('gives draw and no-contest finishes no methods and no title change', () => {
    const notWins = SHIPPED.filter((finish) => finish.outcomeKind !== 'win');
    expect(notWins.map((finish) => finish.key).sort()).toEqual([
      'finish.double-count-out',
      'finish.no-contest',
      'finish.stalemate',
    ]);
    for (const finish of notWins) {
      expect(finish.methods).toEqual([]);
      expect(finish.allowsTitleChange).toBe(false);
    }
  });

  it('never lets a count-out or a disqualification change a title', () => {
    expect(shipped('finish.count-out').allowsTitleChange).toBe(false);
    expect(shipped('finish.disqualification').allowsTitleChange).toBe(false);
    expect(shipped('finish.count-out').methods).toEqual([
      { methodKey: 'method.count-out', weight: 1 },
    ]);
  });

  it('keeps effects as numbers in fields', () => {
    expect(shipped('finish.clean').effects).toEqual({ workRate: 0, crowd: 1 });
    expect(shipped('finish.no-contest').effects).toEqual({ workRate: -5, crowd: -5 });
  });
});

describe('methods and the tiny fixture', () => {
  it('ship count-out and disqualification that cannot move titles, and knockout', () => {
    const methods = TEST_CATALOGS.methods ?? {};
    expect(methods[parseContentKey('method.count-out')]?.changesTitles).toBe(false);
    expect(methods[parseContentKey('method.disqualification')]?.changesTitles).toBe(false);
    expect(methods[parseContentKey('method.knockout')]?.changesTitles).toBe(true);
  });

  it('keeps method keys and finish keys in their own namespaces in the tiny world', () => {
    const matches = tinyWorld().world.tables.segments.values().filter(isMatch);
    const methodKeys = matches.flatMap((segment) =>
      segment.outcome?.kind === 'win' ? [segment.outcome.methodKey] : [],
    );
    expect(methodKeys.length).toBeGreaterThan(0);
    expect(methodKeys.every((key) => key.startsWith('method.'))).toBe(true);
    const finishKeys = matches.flatMap((segment) =>
      segment.match.finishKey === null ? [] : [segment.match.finishKey],
    );
    expect(finishKeys).toEqual(['finish.clean']);
  });
});

describe('checkFinishCatalog on a broken catalog', () => {
  it('reports a method that is not in the method catalog', () => {
    const clean = shipped('finish.clean');
    const broken = {
      ...clean,
      methods: [...clean.methods, { methodKey: parseContentKey('method.body-slam'), weight: 1 }],
    };
    const issues = checkFinishCatalog(
      withFinishes(SHIPPED.map((finish) => (finish.key === clean.key ? broken : finish))),
    );
    expect(issues.map((issue) => [issue.code, issue.key, issue.path])).toEqual([
      [FINISH_CATALOG_ISSUE_CODES.unknownMethod, 'finish.clean', 'methods[3].methodKey'],
    ]);
  });

  it('reports a finish with both only and except', () => {
    const flash = shipped('finish.flash');
    const broken = {
      ...flash,
      matchTypes: {
        only: [parseContentKey('match.singles')],
        except: [parseContentKey('match.tag-team')],
      },
    };
    const issues = checkFinishCatalog(
      withFinishes(SHIPPED.map((finish) => (finish.key === flash.key ? broken : finish))),
    );
    expect(issues.map((issue) => [issue.code, issue.key, issue.path])).toEqual([
      [FINISH_CATALOG_ISSUE_CODES.invalid, 'finish.flash', 'matchTypes'],
    ]);
  });

  it('reports a match type with no automatic win finish', () => {
    const sprint = parseContentKey('match.sprint');
    const entries = SHIPPED.map((finish) =>
      finish.outcomeKind === 'win' ? { ...finish, matchTypes: { except: [sprint] } } : finish,
    );
    expect(
      checkFinishCatalog(withFinishes(entries)).map((issue) => [issue.code, issue.key]),
    ).toEqual([[FINISH_CATALOG_ISSUE_CODES.noAutoFinish, 'match.sprint']]);
  });

  it('reports an unknown match type, a title finish with no title method and a stray key', () => {
    const clean = shipped('finish.clean');
    const flash = shipped('finish.flash');
    const cheating = shipped('finish.cheating');
    const entries: Record<string, FinishEntry> = {
      ...withFinishes(SHIPPED).finishes,
      [clean.key]: { ...clean, matchTypes: { except: [parseContentKey('match.cage')] } },
      [flash.key]: {
        ...flash,
        methods: [{ methodKey: parseContentKey('method.count-out'), weight: 1 }],
      },
      [cheating.key]: { ...cheating, key: parseContentKey('finish.flash') },
    };
    const issues = checkFinishCatalog({ ...TEST_CATALOGS, finishes: entries });
    expect(issues.map((issue) => [issue.code, issue.key])).toEqual([
      [FINISH_CATALOG_ISSUE_CODES.keyMismatch, 'finish.cheating'],
      [FINISH_CATALOG_ISSUE_CODES.unknownMatchType, 'finish.clean'],
      [FINISH_CATALOG_ISSUE_CODES.noTitleMethod, 'finish.flash'],
      [FINISH_CATALOG_ISSUE_CODES.duplicateKey, 'finish.flash'],
    ]);
  });

  it('checks nothing when the catalogs hold no finishes', () => {
    expect(checkFinishCatalog({})).toEqual([]);
  });
});

describe('finishesOf and finishOf', () => {
  const world = worldBuilder().withCatalogs().build().world;

  it('list the finishes in catalog order', () => {
    expect(finishesOf(world).map((finish) => finish.key)).toEqual([
      'finish.clean',
      'finish.flash',
      'finish.cheating',
      'finish.interference',
      'finish.count-out',
      'finish.disqualification',
      'finish.controversial',
      'finish.double-count-out',
      'finish.stalemate',
      'finish.no-contest',
    ]);
  });

  it('find one finish by key, and nothing for an unknown key or a world without finishes', () => {
    expect(finishOf(world, 'finish.stalemate')?.name).toBe('Stalemate');
    expect(finishOf(world, 'finish.time-limit')).toBeUndefined();
    const bare = worldBuilder().build().world;
    expect(finishesOf(bare)).toEqual([]);
    expect(finishOf(bare, 'finish.clean')).toBeUndefined();
  });
});
