/**
 * Helpers the schedule editor tests share, on the calendar's lifecycle world: promotion A run by
 * `player-1` (with a weekly Monday show when asked), promotion B run by the computer. Today is
 * Monday 5 January 2026, so with the default `calendar.editor.minLeadDays` of 1 changes apply
 * from Tuesday 6 January and the stored horizon ends on 5 April 2026.
 */

import { expect } from 'vitest';
import {
  createEngine,
  engineLoadOptions,
  engineSaveState,
  initialEngineState,
  type Engine,
  type EngineState,
} from '../../../../src/core/api';
import { addDays, compareDates, type GameDate } from '../../../../src/core/date';
import type { EventDefinitionId, PromotionId } from '../../../../src/core/ids';
import { checkWorld } from '../../../../src/model/integrity';
import { TABLES } from '../../../../src/model/tables';
import { encodeSave } from '../../../../src/persistence/codec';
import { loadSave } from '../../../../src/persistence/load';
import { createSaveDocument } from '../../../../src/persistence/world-document';
import type { DefinitionDraft } from '../../../../src/systems/calendar/editor';
import { SYSTEMS_WITHOUT_SHOW_DAY_GATE, type BuiltWorld } from '../../../support';
import { gameDate } from '../lifecycle-world';
import { TEST_ENGINE_VERSION, TEST_SAVED_AT } from '../../../support/saves';

export const TUESDAY = gameDate('2026-01-06');
export const HORIZON_END = gameDate('2026-04-05');

/** An engine over the built world, without the show-day gate, with optional tunable overrides. */
export function editorEngine(built: BuiltWorld, overrides: Record<string, number> = {}): Engine {
  const state: EngineState = { ...initialEngineState(built.world), tunableOverrides: overrides };
  return createEngine({ state, systems: SYSTEMS_WITHOUT_SHOW_DAY_GATE });
}

/** A weekly draft for promotion A: 6 slots, no pre-show, home region. */
export function weeklyDraft(overrides: Partial<DefinitionDraft> = {}): DefinitionDraft {
  return {
    name: 'Test Friday',
    brandId: null,
    importance: 'regular',
    recurrence: { kind: 'weekly', weekdays: [4] },
    format: { slots: 6, preShowSlots: 0 },
    televised: false,
    preferredRegionId: null,
    preferredVenueId: null,
    ...overrides,
  };
}

/** The stored shows of a definition as `[date, status]`, earliest first. */
export function showsOf(engine: Engine, definitionId: EventDefinitionId): [GameDate, string][] {
  return engine
    .exportState()
    .world.tables.eventInstances.filter((show) => show.eventDefinitionId === definitionId)
    .map((show): [GameDate, string] => [show.date, show.status])
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

/** Every `step` days from `from` through `to`. */
export function everyWeekday(from: string, to: string, step = 7): GameDate[] {
  const dates: GameDate[] = [];
  const last = gameDate(to);
  for (let at = gameDate(from); compareDates(at, last) <= 0; at = addDays(at, step)) {
    dates.push(at);
  }
  return dates;
}

/** Saves the engine's state, loads it back and expects a clean world. Returns the loaded world. */
export async function expectSavesAndLoadsClean(engine: Engine, promotionId: PromotionId) {
  const doc = createSaveDocument(engineSaveState(engine.exportState()), {
    headerPromotionId: promotionId,
    savedAt: TEST_SAVED_AT,
    label: 'Schedule editor',
    engineVersion: TEST_ENGINE_VERSION,
  });
  const report = await loadSave(await encodeSave(doc), TABLES, engineLoadOptions());
  if (!report.ok) {
    expect.fail(JSON.stringify(report.issues, null, 2));
  }
  expect(
    checkWorld(report.world, TABLES).issues.filter((issue) => issue.severity !== 'warning'),
  ).toEqual([]);
  return report.world;
}

/** Every news, mail and ledger row that names a show still finds it. */
export function expectNoDanglingShowRefs(engine: Engine): void {
  const tables = engine.exportState().world.tables;
  const shows = new Set<string>(tables.eventInstances.map((show) => show.id));
  const pointers = [
    ...tables.news.map((row) => row.refs.eventInstanceId),
    ...tables.mail.map((row) => row.refs.eventInstanceId),
    ...tables.ledgerEntries.map((row) => row.refs.eventInstanceId),
    ...tables.segments.map((row) => row.eventInstanceId),
  ].filter((id) => id !== null);
  expect(pointers.filter((id) => !shows.has(id))).toEqual([]);
}
