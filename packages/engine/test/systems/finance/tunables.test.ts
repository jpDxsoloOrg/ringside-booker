// The finance system's tunables and registration (ECO1-01). Design: docs/design/finances.md
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { FINANCE_TUNABLE_CATEGORY, financeTunables } from '../../../src/systems/finance';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import type { TunableDefinitions } from '../../../src/core/tunables/define';
import { worldBuilder } from '../../support';

const FINANCES_DOC = new URL('../../../../../docs/design/finances.md', import.meta.url);

/** The anchors of a markdown file's headings, the way GitHub makes them. */
function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading?.[1] !== undefined) {
      anchors.add(
        heading[1]
          .trim()
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .replace(/\s/g, '-'),
      );
    }
  }
  return anchors;
}

describe('finance tunables', () => {
  it('puts every finance.* key in the Finances category with a docRef into finances.md', () => {
    const anchors = headingAnchors(readFileSync(FINANCES_DOC, 'utf8'));
    const financeKeys = Object.keys(ALL_TUNABLES).filter((key) => key.startsWith('finance.'));
    expect(financeKeys.sort()).toEqual(Object.keys(financeTunables).sort());
    // Typed as the general shape: the set is empty until ECO1-02..04 add keys.
    const definitions: TunableDefinitions = financeTunables;
    for (const [key, def] of Object.entries(definitions)) {
      expect(def.category, key).toBe(FINANCE_TUNABLE_CATEGORY);
      const [file, anchor] = (def.docRef ?? '').split('#');
      expect(file, key).toBe('finances.md');
      expect(anchors.has(anchor ?? ''), `${key}: #${anchor ?? ''}`).toBe(true);
    }
  });

  it('has the sections the later finance tickets fill in', () => {
    const anchors = headingAnchors(readFileSync(FINANCES_DOC, 'utf8'));
    for (const anchor of [
      'postmoney',
      'categories',
      'reach-and-size',
      'payroll',
      'medical',
      'show-costs',
      'policies',
      'queries',
      'seams',
    ]) {
      expect(anchors.has(anchor), anchor).toBe(true);
    }
  });
});

describe('finance system', () => {
  it('is registered once, with no duplicate system ids, and the engine starts with it', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids.filter((id) => id === 'finance')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() =>
      createEngine({
        state: initialEngineState(worldBuilder().build().world),
        systems: defaultSystems,
      }),
    ).not.toThrow();
  });
});
