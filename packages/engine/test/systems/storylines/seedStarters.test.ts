// Starter storylines at new game (CRTV3-02). Design: docs/design/storylines.md#starters
import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineState } from '../../../src/core/api';
import { findTraceNodes } from '../../../src/core/trace/helpers';
import { isFullTrace, refKey, type StoredTraceEntry } from '../../../src/core/trace/store';
import type { Storyline } from '../../../src/model/entities/storyline';
import {
  STARTER_SUMMARY,
  storylineHeatTraceRef,
  storylineStarterTraceRef,
} from '../../../src/systems/storylines';
import { createEngineTunables } from '../../../src/systems/tunables';
import { startDefaultGame } from '../calendar/default-game';

const DEFAULTS = createEngineTunables();
const START_BASE = DEFAULTS.get('storylines.heat.startBase');
const START_MAX = DEFAULTS.get('storylines.heat.startMax');

function traceOf(state: EngineState, key: string): StoredTraceEntry | undefined {
  return (
    state.traces.full.find((entry) => refKey(entry.ref) === key) ??
    state.traces.summaries.find((entry) => refKey(entry.ref) === key)
  );
}

function storylinesBy(state: EngineState): Map<string, Storyline[]> {
  const byPromotion = new Map<string, Storyline[]>();
  for (const storyline of state.world.tables.storylines) {
    const list = byPromotion.get(storyline.promotionId) ?? [];
    list.push(storyline);
    byPromotion.set(storyline.promotionId, list);
  }
  return byPromotion;
}

describe('storylines.seedStarters on the default world', () => {
  let state: EngineState;
  beforeAll(() => {
    state = startDefaultGame({ seed: 'storyline-starters' });
  });

  it('gives every active promotion two starters of a same-gender face and heel', () => {
    const { promotions, employments, people } = state.world.tables;
    const byPromotion = storylinesBy(state);
    const active = promotions.filter((promotion) => promotion.status === 'active');
    expect(active.length).toBeGreaterThan(0);
    for (const promotion of active) {
      const starters = byPromotion.get(promotion.id) ?? [];
      expect(starters, promotion.name).toHaveLength(2);
      const seen = new Set<string>();
      for (const storyline of starters) {
        expect(storyline).toMatchObject({
          status: 'active',
          startedOn: state.world.meta.startDate,
          summary: STARTER_SUMMARY,
          lastProgressOn: null,
        });
        expect(storyline.members.map((member) => member.side)).toEqual(['face', 'heel']);
        const genders = storyline.members.map((member) => {
          expect(seen.has(member.personId), `${member.personId} twice`).toBe(false);
          seen.add(member.personId);
          const person = people.find((row) => row.id === member.personId);
          expect(person?.status).toBe('active');
          expect(person?.injury).toBeNull();
          const employment = employments.find(
            (row) =>
              row.personId === member.personId &&
              row.promotionId === promotion.id &&
              row.status === 'active',
          );
          expect(employment?.role).toBe('wrestler');
          expect(employment?.alignment).toBe(member.side);
          return person?.gender;
        });
        expect(new Set(genders).size).toBe(1);
        const [face, heel] = storyline.members.map(
          (member) =>
            employments.find(
              (row) => row.personId === member.personId && row.promotionId === promotion.id,
            )?.ringName,
        );
        expect(storyline.name).toBe(`${face ?? ''} vs. ${heel ?? ''}`);
        expect(storyline.heat).toBeGreaterThanOrEqual(START_BASE);
        expect(storyline.heat).toBeLessThanOrEqual(START_MAX);
      }
    }
  });

  it("gives Golden Poppy Wrestling women's storylines", () => {
    const poppy = state.world.tables.promotions.find((row) => row.name.startsWith('Golden Poppy'));
    expect(poppy).toBeDefined();
    const starters = storylinesBy(state).get(poppy?.id ?? '') ?? [];
    expect(starters).toHaveLength(2);
    for (const storyline of starters) {
      for (const member of storyline.members) {
        const person = state.world.tables.people.find((row) => row.id === member.personId);
        expect(person?.gender).toBe('female');
      }
    }
  });

  it("keeps the player's Why?s in full, starting from the base heat, and rivals' as summaries", () => {
    const human = state.world.tables.promotions.find((row) => row.controller.kind === 'human');
    for (const storyline of state.world.tables.storylines) {
      const heat = traceOf(state, refKey(storylineHeatTraceRef(storyline.id)));
      const starter = traceOf(state, refKey(storylineStarterTraceRef(storyline.id)));
      expect(heat?.value).toBe(storyline.heat);
      expect(starter).toBeDefined();
      if (storyline.promotionId !== human?.id) {
        expect(heat !== undefined && isFullTrace(heat)).toBe(false);
        continue;
      }
      if (
        heat === undefined ||
        !isFullTrace(heat) ||
        starter === undefined ||
        !isFullTrace(starter)
      ) {
        throw new Error('expected full traces for the player');
      }
      expect(heat.trace.children?.[0]).toMatchObject({
        kind: 'tunable',
        key: 'storylines.heat.startBase',
        label: 'Base starting heat',
      });
      expect(starter.trace).toMatchObject({ kind: 'decision', label: 'Starter storyline' });
      const rolls = findTraceNodes(starter.trace, 'roll').map((node) => node.roll.stream);
      expect(rolls).toEqual(['storylines.starters', 'storylines.starters']);
    }
  });

  it('publishes storyline.started with source setup for each starter', () => {
    const started = state.events.recent.filter((event) => event.type === 'storyline.started');
    expect(started).toHaveLength(state.world.tables.storylines.length);
    for (const event of started) {
      expect(event.payload).toMatchObject({ source: 'setup' });
    }
  });

  it('gives the same storylines for the same seed', () => {
    const again = startDefaultGame({ seed: 'storyline-starters' });
    expect(again.world.tables.storylines).toEqual(state.world.tables.storylines);
  });
});

describe('storylines.seedStarters turned off', () => {
  it('creates none with storylines.starterPerPromotion 0', () => {
    const state = startDefaultGame({
      seed: 'storyline-starters',
      tunableOverrides: { 'storylines.starterPerPromotion': 0 },
    });
    expect(state.world.tables.storylines).toEqual([]);
  });
});
