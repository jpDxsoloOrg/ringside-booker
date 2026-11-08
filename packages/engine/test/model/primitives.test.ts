import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  zBasisPoints,
  zCents,
  zContentKey,
  zGameDate,
  zId,
  zImageRef,
  zNonNegativeCents,
  zNonNegativeInt,
  zPositiveInt,
  zSigned100,
  zStat,
  zTemplatedText,
  zWeekday,
} from '../../src/model/primitives';

const nonFinite = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

function expectAccepts(schema: z.ZodType, values: readonly unknown[]): void {
  for (const value of values) {
    expect(schema.safeParse(value).success, `should accept ${String(value)}`).toBe(true);
  }
}

function expectRejects(schema: z.ZodType, values: readonly unknown[]): void {
  for (const value of values) {
    expect(schema.safeParse(value).success, `should reject ${String(value)}`).toBe(false);
  }
}

describe('number helpers', () => {
  it('zStat accepts 0..100', () => {
    expectAccepts(zStat, [0, 100, 55.5]);
    expectRejects(zStat, [-0.001, 100.001, '50', ...nonFinite]);
  });

  it('zSigned100 accepts -100..100', () => {
    expectAccepts(zSigned100, [-100, 0, 100, -12.5]);
    expectRejects(zSigned100, [-100.001, 100.001, ...nonFinite]);
  });

  it('zBasisPoints accepts whole numbers 0..10000', () => {
    expectAccepts(zBasisPoints, [0, 10_000, 250]);
    expectRejects(zBasisPoints, [-1, 10_001, 2.5, ...nonFinite]);
  });

  it('zPositiveInt accepts whole numbers from 1', () => {
    expectAccepts(zPositiveInt, [1, Number.MAX_SAFE_INTEGER]);
    expectRejects(zPositiveInt, [0, 1.5, Number.MAX_SAFE_INTEGER + 1, ...nonFinite]);
  });

  it('zNonNegativeInt accepts whole numbers from 0', () => {
    expectAccepts(zNonNegativeInt, [0, Number.MAX_SAFE_INTEGER]);
    expectRejects(zNonNegativeInt, [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, ...nonFinite]);
  });

  it('zCents accepts any safe whole number of cents', () => {
    expectAccepts(zCents, [0, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]);
    expectRejects(zCents, [0.5, Number.MAX_SAFE_INTEGER + 1, '100', ...nonFinite]);
  });

  it('zNonNegativeCents accepts whole cents from 0', () => {
    expectAccepts(zNonNegativeCents, [0, Number.MAX_SAFE_INTEGER]);
    expectRejects(zNonNegativeCents, [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, ...nonFinite]);
  });

  it('zWeekday accepts 0..6', () => {
    expectAccepts(zWeekday, [0, 6]);
    expectRejects(zWeekday, [-1, 7, 2.5, ...nonFinite]);
  });
});

describe('zId', () => {
  it('accepts IDs of its kind only', () => {
    expectAccepts(zId('person'), ['per_0000000001']);
    expectRejects(zId('person'), ['pro_0000000001', 'per_00000000i1', 'per_1', 42, null]);
    expectAccepts(zId('promotion'), ['pro_0000000001']);
  });
});

describe('zGameDate', () => {
  it('accepts valid dates at the range edges', () => {
    expectAccepts(zGameDate, ['1900-01-01', '2999-12-31', '2024-02-29']);
    expectRejects(zGameDate, ['1899-12-31', '3000-01-01', '2023-02-29', '2024-13-01', 20_240_101]);
  });
});

describe('zContentKey', () => {
  it('accepts dotted lowercase keys', () => {
    expectAccepts(zContentKey, ['gimmick.monster-heel', 'finish.pinfall', 'news.title.changed2']);
    expectRejects(zContentKey, [
      'finish',
      'Finish.pinfall',
      '1finish.pinfall',
      'finish.-pinfall',
      'finish.pin_fall',
      'finish.',
      '',
    ]);
  });
});

describe('zImageRef', () => {
  it('accepts null, relative paths and placeholders', () => {
    expectAccepts(zImageRef, [
      null,
      'people/per_0000000001.webp',
      'logo.png',
      'placeholder:person',
      'placeholder:titleReign',
    ]);
  });

  it('rejects absolute paths, parent segments, URLs and empty strings', () => {
    expectRejects(zImageRef, [
      '',
      '/people/a.png',
      '../secrets.png',
      'people/../a.png',
      'people//a.png',
      'https://example.com/a.png',
      'placeholder:',
      'people\\a.png',
      undefined,
    ]);
  });
});

describe('zTemplatedText', () => {
  it('accepts a key with string and number params', () => {
    expectAccepts(zTemplatedText, [
      { key: 'news.title-changed', params: {} },
      { key: 'news.title-changed', params: { champion: 'per_0000000001', days: 42 } },
    ]);
  });

  it('rejects bad keys and non-finite or non-scalar params', () => {
    expectRejects(zTemplatedText, [
      { key: 'news', params: {} },
      { key: 'news.title-changed' },
      { key: 'news.title-changed', params: { days: Number.NaN } },
      { key: 'news.title-changed', params: { days: Number.POSITIVE_INFINITY } },
      { key: 'news.title-changed', params: { flag: true } },
      { key: 'news.title-changed', params: { nested: { a: 1 } } },
    ]);
  });
});
