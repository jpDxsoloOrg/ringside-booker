import { describe, expect, it } from 'vitest';
import { UniqueIndexError } from '../../../src/core/errors';
import { TitleSchema } from '../../../src/model/entities/title';
import { TitleReignSchema } from '../../../src/model/entities/title-reign';
import {
  check,
  date,
  emptyShowWorld,
  issueCodes,
  makeReign,
  makeTitle,
  personId,
  segmentId,
  teamId,
  titleId,
  type ShowWorld,
} from '../../support/show-world';

function worldWithTitle(holderCount: 1 | 2 | 3 = 1): ShowWorld {
  const world = emptyShowWorld();
  world.tables.titles._put(makeTitle(1, { holderCount }));
  return world;
}

describe('TitleSchema', () => {
  it('accepts a valid title', () => {
    expect(TitleSchema.safeParse(makeTitle(1)).success).toBe(true);
  });

  it('requires retiredOn exactly when the title is retired', () => {
    expect(TitleSchema.safeParse(makeTitle(1, { status: 'retired' })).success).toBe(false);
    expect(
      TitleSchema.safeParse(makeTitle(1, { status: 'active', retiredOn: date('2026-01-01') }))
        .success,
    ).toBe(false);
    expect(
      TitleSchema.safeParse(makeTitle(1, { status: 'retired', retiredOn: date('2026-01-01') }))
        .success,
    ).toBe(true);
  });

  it('rejects a weight division whose minimum is above its maximum', () => {
    const title = makeTitle(1, {
      division: { gender: 'male', minWeightKg: 100, maxWeightKg: 90 },
    });
    expect(TitleSchema.safeParse(title).success).toBe(false);
  });

  it('rejects a holder count outside 1-3 and a colour that is not #rrggbb', () => {
    expect(TitleSchema.safeParse({ ...makeTitle(1), holderCount: 4 }).success).toBe(false);
    expect(TitleSchema.safeParse(makeTitle(1, { color: 'gold' })).success).toBe(false);
  });

  it('has no current-champion field: the open reign is the champion', () => {
    expect(Object.keys(TitleSchema.shape)).not.toContain('currentChampionId');
    expect(TitleSchema.safeParse({ ...makeTitle(1), currentChampionId: personId(1) }).success).toBe(
      false,
    );
  });
});

describe('TitleReignSchema', () => {
  it('accepts a current reign and a closed one', () => {
    expect(TitleReignSchema.safeParse(makeReign(1)).success).toBe(true);
    const closed = makeReign(2, {
      lostOn: date('2026-02-01'),
      endReason: 'lost',
      endedInSegmentId: segmentId(4),
    });
    expect(TitleReignSchema.safeParse(closed).success).toBe(true);
  });

  it('rejects a reign that ends before it starts', () => {
    const reign = makeReign(1, { wonOn: date('2026-02-01'), lostOn: date('2026-01-01') });
    const result = TitleReignSchema.safeParse({ ...reign, endReason: 'lost' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('lostOn');
  });

  it('requires endReason exactly when lostOn is set', () => {
    expect(TitleReignSchema.safeParse(makeReign(1, { endReason: 'vacated' })).success).toBe(false);
    expect(TitleReignSchema.safeParse(makeReign(1, { lostOn: date('2026-02-01') })).success).toBe(
      false,
    );
  });

  it('rejects duplicate holders and a names list of the wrong length', () => {
    const duplicate = makeReign(1, {
      holderIds: [personId(1), personId(1)],
      holderNamesAtTime: ['A', 'B'],
    });
    expect(TitleReignSchema.safeParse(duplicate).success).toBe(false);
    const missingName = makeReign(1, {
      holderIds: [personId(1), personId(2)],
      holderNamesAtTime: ['A'],
    });
    expect(TitleReignSchema.safeParse(missingName).success).toBe(false);
  });
});

describe('titleReigns table', () => {
  it('finds the current champion with openByTitle', () => {
    const world = worldWithTitle();
    world.tables.titleReigns._put(
      makeReign(1, { lostOn: date('2026-01-10'), endReason: 'lost', holderIds: [personId(1)] }),
    );
    world.tables.titleReigns._put(
      makeReign(2, { wonOn: date('2026-01-10'), holderIds: [personId(2)] }),
    );
    expect(world.tables.titleReigns.lookupOne('openByTitle', titleId(1))?.holderIds).toEqual([
      personId(2),
    ]);
    expect(world.tables.titleReigns.lookup('byHolder', personId(1))).toHaveLength(1);
    expect(check(world)).toEqual({ ok: true, issues: [], truncated: 0 });
  });

  it('rejects two open reigns for one title with the unique index', () => {
    const world = worldWithTitle();
    world.tables.titleReigns._put(makeReign(1));
    expect(() => {
      world.tables.titleReigns._put(makeReign(2, { holderIds: [personId(2)] }));
    }).toThrow(UniqueIndexError);
  });

  it('reports overlapping closed reigns', () => {
    const world = worldWithTitle();
    world.tables.titleReigns._put(
      makeReign(1, { wonOn: date('2026-01-01'), lostOn: date('2026-03-01'), endReason: 'lost' }),
    );
    world.tables.titleReigns._put(
      makeReign(2, {
        holderIds: [personId(2)],
        wonOn: date('2026-02-01'),
        lostOn: date('2026-04-01'),
        endReason: 'lost',
      }),
    );
    const report = check(world);
    expect(issueCodes(report)).toEqual(['titleReigns.overlap']);
    expect(report.issues[0]?.id).toBe(makeReign(2).id);
  });

  it('allows a title to change hands twice on one day', () => {
    const world = worldWithTitle();
    world.tables.titleReigns._put(
      makeReign(1, { wonOn: date('2026-01-01'), lostOn: date('2026-02-01'), endReason: 'lost' }),
    );
    world.tables.titleReigns._put(
      makeReign(2, {
        holderIds: [personId(2)],
        wonOn: date('2026-02-01'),
        lostOn: date('2026-02-01'),
        endReason: 'lost',
      }),
    );
    world.tables.titleReigns._put(
      makeReign(3, { holderIds: [personId(3)], wonOn: date('2026-02-01') }),
    );
    expect(check(world).ok).toBe(true);
  });

  it('reports a reign that starts while the title is still held', () => {
    const world = worldWithTitle();
    world.tables.titleReigns._put(makeReign(1, { wonOn: date('2026-01-01') }));
    world.tables.titleReigns._put(
      makeReign(2, {
        holderIds: [personId(2)],
        wonOn: date('2026-02-01'),
        lostOn: date('2026-02-10'),
        endReason: 'lost',
      }),
    );
    expect(issueCodes(check(world))).toEqual(['titleReigns.overlap']);
  });

  it('reports 2 holders on a singles title', () => {
    const world = worldWithTitle(1);
    world.tables.titleReigns._put(
      makeReign(1, {
        holderIds: [personId(1), personId(2)],
        holderNamesAtTime: ['One', 'Two'],
        teamId: teamId(1),
      }),
    );
    expect(issueCodes(check(world))).toEqual(['titleReigns.holderCountMismatch']);
  });

  it('accepts 2 holders on a tag title', () => {
    const world = worldWithTitle(2);
    world.tables.titleReigns._put(
      makeReign(1, {
        holderIds: [personId(1), personId(2)],
        holderNamesAtTime: ['One', 'Two'],
        teamId: teamId(1),
      }),
    );
    expect(check(world).ok).toBe(true);
  });

  it('reports a reign whose holder does not exist', () => {
    const world = worldWithTitle();
    world.tables.titleReigns._put(makeReign(1, { holderIds: [personId(99)] }));
    expect(check(world).issues).toEqual([
      expect.objectContaining({ code: 'ref.dangling', path: 'holderIds[0]' }),
    ]);
  });
});
