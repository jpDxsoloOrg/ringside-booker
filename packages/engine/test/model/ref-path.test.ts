import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/core/errors';
import { parseRefPath, resolveRefPath } from '../../src/model/ref-path';

describe('parseRefPath', () => {
  it('parses plain, nested, array and record-key segments', () => {
    expect(parseRefPath('promotionId')).toEqual([{ field: 'promotionId', fanOut: 'none' }]);
    expect(parseRefPath('members[].personId')).toEqual([
      { field: 'members', fanOut: 'array' },
      { field: 'personId', fanOut: 'none' },
    ]);
    expect(parseRefPath('crew.announcerIds[]')).toEqual([
      { field: 'crew', fanOut: 'none' },
      { field: 'announcerIds', fanOut: 'array' },
    ]);
    expect(parseRefPath('regionalPop{}')).toEqual([{ field: 'regionalPop', fanOut: 'recordKeys' }]);
  });

  it('returns the same parsed object for the same path', () => {
    expect(parseRefPath('members[].personId')).toBe(parseRefPath('members[].personId'));
  });

  it.each(['', 'a..b', '.a', 'a.', 'a[]x', 'a[', '1abc', 'a{}.b', 'a b', 'a[0]'])(
    'rejects %j',
    (path) => {
      expect(() => parseRefPath(path)).toThrow(InvalidArgumentError);
    },
  );
});

describe('resolveRefPath', () => {
  it('resolves a plain field', () => {
    expect(resolveRefPath({ promotionId: 'pro_1' }, 'promotionId')).toEqual([
      { path: 'promotionId', value: 'pro_1' },
    ]);
  });

  it('fans out over an array and keeps walking inside each element', () => {
    const row = { members: [{ personId: 'per_a' }, { personId: 'per_b' }, {}] };
    expect(resolveRefPath(row, 'members[].personId')).toEqual([
      { path: 'members[0].personId', value: 'per_a' },
      { path: 'members[1].personId', value: 'per_b' },
    ]);
  });

  it('fans out over a nested array of IDs', () => {
    const row = { crew: { announcerIds: ['per_a', 'per_b'] } };
    expect(resolveRefPath(row, 'crew.announcerIds[]')).toEqual([
      { path: 'crew.announcerIds[0]', value: 'per_a' },
      { path: 'crew.announcerIds[1]', value: 'per_b' },
    ]);
  });

  it('uses record keys as the references, in sorted order', () => {
    const row = { regionalPop: { reg_b: 12, reg_a: 40 } };
    expect(resolveRefPath(row, 'regionalPop{}')).toEqual([
      { path: 'regionalPop{reg_a}', value: 'reg_a' },
      { path: 'regionalPop{reg_b}', value: 'reg_b' },
    ]);
  });

  it('yields a null at the end of the path so the caller can judge nullability', () => {
    expect(resolveRefPath({ managerId: null }, 'managerId')).toEqual([
      { path: 'managerId', value: null },
    ]);
    expect(resolveRefPath({ tagIds: ['tit_a', null] }, 'tagIds[]')).toEqual([
      { path: 'tagIds[0]', value: 'tit_a' },
      { path: 'tagIds[1]', value: null },
    ]);
  });

  it('skips null containers', () => {
    expect(resolveRefPath({ crew: null }, 'crew.announcerIds[]')).toEqual([]);
    expect(resolveRefPath({ members: null }, 'members[].personId')).toEqual([]);
    expect(resolveRefPath({ members: [null] }, 'members[].personId')).toEqual([]);
    expect(resolveRefPath({ regionalPop: null }, 'regionalPop{}')).toEqual([]);
  });

  it('skips missing optional fields at any depth', () => {
    expect(resolveRefPath({}, 'promotionId')).toEqual([]);
    expect(resolveRefPath({ promotionId: undefined }, 'promotionId')).toEqual([]);
    expect(resolveRefPath({}, 'crew.announcerIds[]')).toEqual([]);
    expect(resolveRefPath({ crew: {} }, 'crew.announcerIds[]')).toEqual([]);
    expect(resolveRefPath({}, 'regionalPop{}')).toEqual([]);
  });

  it('yields nothing for empty arrays and records', () => {
    expect(resolveRefPath({ tagIds: [] }, 'tagIds[]')).toEqual([]);
    expect(resolveRefPath({ regionalPop: {} }, 'regionalPop{}')).toEqual([]);
  });

  it('yields the out-of-place value when the row has the wrong shape', () => {
    expect(resolveRefPath({ tagIds: 'tit_a' }, 'tagIds[]')).toEqual([
      { path: 'tagIds', value: 'tit_a' },
    ]);
    expect(resolveRefPath({ regionalPop: ['reg_a'] }, 'regionalPop{}')).toEqual([
      { path: 'regionalPop', value: ['reg_a'] },
    ]);
  });

  it('does not read inherited properties', () => {
    const row: unknown = Object.create({ promotionId: 'pro_inherited' });
    expect(resolveRefPath(row, 'promotionId')).toEqual([]);
  });
});
