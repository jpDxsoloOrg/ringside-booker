import { describe, expect, it } from 'vitest';
import { loadWorldFromPacks, packs, type RawPack } from '@ringside/engine';
import {
  buildReport,
  careerStageOf,
  describe as describeValues,
  renderReportMarkdown,
  renderReportText,
} from '../src/report';
import { loadForRules, readMiniWorld } from './helpers';

const MINI_ROOTS = ['mini-world'];

function reportFor(rawPacks: readonly RawPack[]): { text: string; markdown: string } {
  const { world, content } = loadForRules(rawPacks, MINI_ROOTS);
  const report = buildReport(world, content);
  return { text: renderReportText(report), markdown: renderReportMarkdown(report) };
}

describe('the distribution report', () => {
  it('matches the snapshot for mini-world', async () => {
    const { text, markdown } = reportFor(await readMiniWorld());
    await expect(markdown).toMatchFileSnapshot('__snapshots__/mini-world-report.md');
    await expect(text).toMatchFileSnapshot('__snapshots__/mini-world-report.txt');
  });

  it('is byte-identical across runs', async () => {
    const first = reportFor(await readMiniWorld());
    const second = reportFor(await readMiniWorld());
    expect(second.text).toBe(first.text);
    expect(second.markdown).toBe(first.markdown);
  });

  it('does not depend on the seed or on the order packs are passed in', async () => {
    const rawPacks = await readMiniWorld();
    const expected = reportFor(rawPacks).markdown;
    const reversed = [...rawPacks].reverse();
    const loaded = loadWorldFromPacks(reversed, MINI_ROOTS, { seed: 'another seed' });
    const resolved = packs.resolvePacks(reversed, MINI_ROOTS);
    if (!loaded.ok || !resolved.ok) {
      throw new Error('mini-world did not load');
    }
    const merged = packs.mergeRecords(resolved.value);
    if (!merged.ok) {
      throw new Error('mini-world did not merge');
    }
    expect(renderReportMarkdown(buildReport(loaded.value.world, merged.value))).toBe(expected);
  });
});

describe('report helpers', () => {
  it('describes values with the population standard deviation', () => {
    expect(describeValues([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({
      n: 8,
      mean: 5,
      sd: 2,
      min: 2,
      max: 9,
    });
    expect(describeValues([])).toBeNull();
  });

  it('puts people in a career stage by years since debut', async () => {
    const { content } = loadForRules(await readMiniWorld(), MINI_ROOTS);
    const otto = content.records.person.get('otto-brand')?.record;
    if (otto === undefined) {
      throw new Error('otto-brand is missing from mini-world');
    }
    const start = '2026-01-05' as const;
    expect(careerStageOf(otto, packs.isoDateSchema.parse(start))).toBe('legend');
    expect(careerStageOf({ ...otto, debutDate: null }, packs.isoDateSchema.parse(start))).toBe(
      'undebuted',
    );
    expect(
      careerStageOf(
        { ...otto, debutDate: packs.isoDateSchema.parse('2023-01-05') },
        packs.isoDateSchema.parse(start),
      ),
    ).toBe('prospect');
  });
});
