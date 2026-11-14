// Story buzz. Design: docs/design/news.md#buzz
import { describe, expect, it } from 'vitest';
import { findTraceNodes, inputOf, type Traced } from '../../../src/core/trace';
import { NEWS_KINDS, type NewsImportance, type NewsKind } from '../../../src/model/entities/news';
import {
  BUZZ_KIND_BASE_KEYS,
  buzzScore,
  type BuzzScoreInputs,
  type BuzzSubject,
} from '../../../src/systems/news';
import { createEngineTunables, type EngineTunables } from '../../../src/systems/tunables';
import { testId } from '../../support';
import { expectSerialisable, expectTraceReplays } from '../../support/trace';

const DEFAULTS = createEngineTunables();

function subject(serial: number, popularity: number): BuzzSubject {
  const id = testId('person', serial);
  return {
    label: `Test Person ${String(serial).padStart(3, '0')}`,
    ref: { kind: 'person', id },
    popularity: inputOf('Worldwide popularity', popularity, { kind: 'person', id }, 'points'),
  };
}

function buzz(
  inputs: Partial<BuzzScoreInputs> & { kind?: NewsKind; importance?: NewsImportance } = {},
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = buzzScore(
    { kind: 'result', importance: 0, subjects: [], ...inputs },
    { tunables },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

function tunableKeys(result: Traced<number>): string[] {
  return findTraceNodes(result.trace, 'tunable').map((node) => node.key);
}

function addLabels(result: Traced<number>): string[] {
  return (
    result.trace.children?.filter((node) => node.kind === 'add').map((node) => node.label) ?? []
  );
}

describe('buzzScore', () => {
  it('scores a story with no subjects from its kind base and importance alone', () => {
    const result = buzz({ kind: 'titleChange', importance: 2 });
    expect(result.value).toBe(35 + 2 * 12);
    expect(result.trace.label).toBe('Story buzz');
    expect(result.trace.unit).toBe('points');
    expect(result.trace.docRef).toBe('docs/design/news.md#buzz');
    expect(result.trace.children?.[0]?.label).toBe('Nothing yet');
    expect(addLabels(result)).toEqual([
      'Base for a title change story',
      'Importance 2 × points per level',
    ]);
    expect(findTraceNodes(result.trace, 'clamp').map((node) => node.label)).toEqual([
      'Kept between 0 and 100',
    ]);
    expect(tunableKeys(result)).toEqual([
      'news.buzz.kindBase.titleChange',
      'news.buzz.importancePoints',
    ]);
  });

  it('says "an" before a kind that starts with a vowel', () => {
    expect(addLabels(buzz({ kind: 'injury' }))[0]).toBe('Base for an injury story');
  });

  it('adds nothing for one subject at popularity 0', () => {
    const result = buzz({ subjects: [subject(1, 0)] });
    expect(result.value).toBe(20);
    expect(addLabels(result)).toContain('Popularity of Test Person 001');
  });

  it('adds popularityMax × 100 / 130 for one subject at popularity 100', () => {
    const result = buzz({ importance: 1, subjects: [subject(1, 100)] });
    expect(result.value).toBeCloseTo(20 + 12 + (40 * 100) / 130, 9);
    const input = findTraceNodes(result.trace, 'input').find(
      (node) => node.label === 'Popularity of Test Person 001',
    );
    expect(input?.ref).toEqual({ kind: 'person', id: testId('person', 1) });
    expect(input?.children?.[0]?.label).toBe('Worldwide popularity');
    expect(tunableKeys(result)).toEqual(
      expect.arrayContaining(['news.buzz.popularityMax', 'news.buzz.popularitySoftCap']),
    );
  });

  it('counts three subjects best known first, the later two at the extra share', () => {
    const result = buzz({ subjects: [subject(3, 30), subject(1, 90), subject(2, 60)] });
    expect(result.value).toBeCloseTo(20 + 30 + (0.25 * (40 * 60)) / 90 + 0.25 * 20, 9);
    expect(addLabels(result).slice(1)).toEqual([
      'Importance 0 × points per level',
      'Popularity of Test Person 001',
      'Popularity of Test Person 002',
      'Popularity of Test Person 003',
    ]);
    const shares = findTraceNodes(result.trace, 'multiply').filter((node) =>
      node.label.startsWith('Each further subject counts'),
    );
    expect(shares.map((node) => node.label)).toEqual([
      'Each further subject counts 0.25',
      'Each further subject counts 0.25',
    ]);
  });

  it('counts only maxSubjects of five subjects and says how many were left out', () => {
    const three = buzz({ subjects: [subject(1, 90), subject(2, 60), subject(3, 30)] });
    const five = buzz({
      subjects: [subject(5, 10), subject(1, 90), subject(4, 20), subject(2, 60), subject(3, 30)],
    });
    expect(five.value).toBeCloseTo(three.value, 9);
    expect(addLabels(five)).toContain('2 more left out: only the 3 best known count');
    expect(tunableKeys(five)).toContain('news.buzz.maxSubjects');
    const one = buzz(
      { subjects: [subject(1, 90), subject(2, 60)] },
      createEngineTunables({ 'news.buzz.maxSubjects': 1 }),
    );
    expect(one.value).toBeCloseTo(20 + 30, 9);
  });

  it('breaks popularity ties by ID, whatever the input order', () => {
    const forward = buzz({ subjects: [subject(1, 50), subject(2, 50)] });
    const backward = buzz({ subjects: [subject(2, 50), subject(1, 50)] });
    expect(addLabels(backward)).toEqual(addLabels(forward));
    expect(addLabels(forward)).toContain('Popularity of Test Person 001');
    expect(backward.value).toBe(forward.value);
  });

  it('gives 0 points with a soft cap of 0 and no popularity, as a branch', () => {
    const noCap = createEngineTunables({ 'news.buzz.popularitySoftCap': 0 });
    const result = buzz({ subjects: [subject(1, 0)] }, noCap);
    expect(result.value).toBe(20);
    expect(findTraceNodes(result.trace, 'branch')).toEqual([
      expect.objectContaining({ label: 'No popularity, no soft cap', taken: true }),
    ]);
  });

  it('gives the full popularityMax with a soft cap of 0 and any popularity', () => {
    const noCap = createEngineTunables({ 'news.buzz.popularitySoftCap': 0 });
    expect(buzz({ subjects: [subject(1, 5)] }, noCap).value).toBeCloseTo(20 + 40, 9);
    expect(findTraceNodes(buzz({ subjects: [subject(1, 5)] }, noCap).trace, 'branch')).toEqual([]);
  });

  it('adds nothing for importance when importancePoints is 0', () => {
    const zero = createEngineTunables({ 'news.buzz.importancePoints': 0 });
    expect(buzz({ importance: 3 }, zero).value).toBe(20);
  });

  it('adds nothing for popularity when popularityMax is 0 or extraSubjectShare is 0', () => {
    expect(
      buzz({ subjects: [subject(1, 100)] }, createEngineTunables({ 'news.buzz.popularityMax': 0 }))
        .value,
    ).toBe(20);
    expect(
      buzz(
        { subjects: [subject(1, 30), subject(2, 30)] },
        createEngineTunables({ 'news.buzz.extraSubjectShare': 0 }),
      ).value,
    ).toBeCloseTo(20 + 20, 9);
  });

  it('reads every kind base from its own key', () => {
    for (const kind of NEWS_KINDS) {
      const key = BUZZ_KIND_BASE_KEYS[kind];
      expect(key).toBe(`news.buzz.kindBase.${kind}`);
      const base = buzz({ kind });
      expect(base.value).toBe(DEFAULTS.get(key));
      const moved = buzz({ kind }, createEngineTunables({ [key]: 77 }));
      expect(moved.value, kind).toBe(77);
      expect(buzz({ kind }, createEngineTunables({ [key]: 0 })).value, kind).toBe(0);
      const other = NEWS_KINDS.find((candidate) => candidate !== kind) ?? 'result';
      expect(buzz({ kind: other }, createEngineTunables({ [key]: 77 })).value).toBe(
        DEFAULTS.get(BUZZ_KIND_BASE_KEYS[other]),
      );
    }
  });

  it('keeps buzz at 100 at most', () => {
    const result = buzz({
      kind: 'titleChange',
      importance: 2,
      subjects: [subject(1, 90), subject(2, 60), subject(3, 30), subject(4, 20), subject(5, 10)],
    });
    expect(result.value).toBe(100);
    const clamp = findTraceNodes(result.trace, 'clamp')[0];
    expect(clamp?.applied).toBe(true);
  });

  it('notes the people and promotions that no longer exist', () => {
    const result = buzz({
      skipped: [
        { kind: 'person', id: testId('person', 9) },
        { kind: 'promotion', id: testId('promotion', 9) },
      ],
    });
    expect(result.value).toBe(20);
    expect(findTraceNodes(result.trace, 'note').map((node) => node.label)).toEqual([
      'A person in this story no longer exists',
      'A promotion in this story no longer exists',
    ]);
  });
});
