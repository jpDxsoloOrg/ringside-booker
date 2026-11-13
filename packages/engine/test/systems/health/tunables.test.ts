// The health system's tunables and registration (WRK6-02). Design: docs/design/health.md
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEngine, initialEngineState } from '../../../src/core/api';
import { defaultSystems } from '../../../src/systems';
import { HEALTH_TUNABLE_CATEGORY, healthTunables } from '../../../src/systems/health';
import { ALL_TUNABLES } from '../../../src/systems/tunables';
import { worldBuilder } from '../../support';

const HEALTH_DOC = new URL('../../../../../docs/design/health.md', import.meta.url);

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

describe('health tunables', () => {
  it('puts every health.* key in the Health category with a docRef into health.md', () => {
    const anchors = headingAnchors(readFileSync(HEALTH_DOC, 'utf8'));
    const healthKeys = Object.keys(ALL_TUNABLES).filter((key) => key.startsWith('health.'));
    expect(healthKeys.sort()).toEqual(Object.keys(healthTunables).sort());
    for (const [key, def] of Object.entries(healthTunables)) {
      expect(def.category, key).toBe(HEALTH_TUNABLE_CATEGORY);
      const [file, anchor] = def.docRef.split('#');
      expect(file, key).toBe('health.md');
      expect(anchors.has(anchor ?? ''), `${key}: #${anchor ?? ''}`).toBe(true);
    }
  });

  it('has the sections the later WRK6 tickets build on', () => {
    const anchors = headingAnchors(readFileSync(HEALTH_DOC, 'utf8'));
    for (const anchor of [
      'fatigue-recovery',
      'condition-cap',
      'condition-recovery',
      'medical-care',
    ]) {
      expect(anchors.has(anchor), anchor).toBe(true);
    }
  });

  it('no longer has the old condition keys', () => {
    expect(Object.keys(ALL_TUNABLES).filter((key) => key.startsWith('condition.'))).toEqual([]);
  });
});

describe('health system', () => {
  it('replaces the condition system in the default systems', () => {
    const ids = defaultSystems.map((system) => system.id);
    expect(ids.filter((id) => id === 'health')).toHaveLength(1);
    expect(ids).not.toContain('condition');
  });

  it('loads a save that overrides a removed condition key: the override is dropped and reported, nothing else is lost', () => {
    const state = {
      ...initialEngineState(worldBuilder().build().world),
      tunableOverrides: {
        'condition.fatigueRecoveryPerDay': 2,
        'condition.fatigueRecoveryBonusMax': 0,
        'health.fatigue.recoveryPerDay': 3,
        'sim.eventLogSize': 100,
      },
    };
    const engine = createEngine({ state, systems: defaultSystems });
    expect(engine.loadIssues.map((issue) => [issue.key, issue.problem]).sort()).toEqual([
      ['condition.fatigueRecoveryBonusMax', 'unknownKey'],
      ['condition.fatigueRecoveryPerDay', 'unknownKey'],
    ]);
    expect(engine.exportState().tunableOverrides).toEqual({
      'health.fatigue.recoveryPerDay': 3,
      'sim.eventLogSize': 100,
    });
  });
});
