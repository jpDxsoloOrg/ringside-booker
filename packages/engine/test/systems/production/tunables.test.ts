// The production system's tunables and registration (ECO7-01). Design: docs/design/production.md
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import type { TunableDefinitions } from '../../../src/core/tunables/define';
import { defaultSystems } from '../../../src/systems';
import { PRODUCTION_TUNABLE_CATEGORY, productionTunables } from '../../../src/systems/production';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';

const PRODUCTION_DOC = new URL('../../../../../docs/design/production.md', import.meta.url);

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

describe('production tunables', () => {
  it('are all in the engine, in the Production category, with a docRef into production.md', () => {
    const anchors = headingAnchors(readFileSync(PRODUCTION_DOC, 'utf8'));
    const definitions: TunableDefinitions = productionTunables;
    for (const [key, def] of Object.entries(definitions)) {
      expect(key in ALL_TUNABLES, key).toBe(true);
      expect(def.category, key).toBe(PRODUCTION_TUNABLE_CATEGORY);
      const [file, anchor] = (def.docRef ?? '').split('#');
      expect(file, key).toBe('production.md');
      expect(anchors.has(anchor ?? ''), `${key}: #${anchor ?? ''}`).toBe(true);
    }
  });

  it("leaves EVT4's show-quality ceiling keys alone", () => {
    for (const key of Object.keys(productionTunables)) {
      expect(key.startsWith('production.ceiling'), key).toBe(false);
      expect(key.startsWith('production.bonusSlot'), key).toBe(false);
    }
  });

  it('has the sections the later production tickets point at', () => {
    const anchors = headingAnchors(readFileSync(PRODUCTION_DOC, 'utf8'));
    for (const anchor of [
      'areas',
      'area-costs',
      'upgrade-fee',
      'popularity-ceiling',
      'popularity-drag',
      'per-show-costs',
      'tv-camera-minimum',
    ]) {
      expect(anchors.has(anchor), anchor).toBe(true);
    }
  });
});

describe('production system', () => {
  it('is registered once, with no duplicate system ids, and the engine starts with it', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids.filter((id) => id === 'production')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(() =>
      createEngine({
        state: initialEngineState(worldBuilder().build().world),
        systems: defaultSystems,
      }),
    ).not.toThrow();
  });
});
