/**
 * Finds a seed for the health e2e flow (WRK6-08, `apps/web/e2e/health-flow.spec.ts`). Dev-only:
 * nothing imports it and it is not shipped. Run from the repo root with
 * `npx tsx packages/engine/test/support/findHealthSeed.ts [first] [count]`.
 *
 * For each candidate seed it plays what the spec plays in the browser: a new game on the shipped
 * default world as Altura with the wizard's defaults (12-month seasons, no settings changed), then
 * Skip days 30. Every stop for one of the player's own shows is cleared the way the spec clears it
 * (the show is cancelled from the Calendar); the first stop for an own injury ends the skip. The
 * seed qualifies when that injury stop comes within 30 days, nothing else stops the day on it, and
 * at least three people world-wide are injured by then. The injured worker's return is then played
 * the same way (skip their days left plus one, cancelling shows and seeing any further injury) and
 * the seed's stops are counted, so the spec stays short.
 *
 * Prints the first qualifying seed and its numbers; record it as `HEALTH_E2E_SEED` in
 * `apps/web/e2e/helpers/game.ts`.
 */

import { createEngine, type Engine } from '../../src/core/api';
import type { GateHit } from '../../src/core/pipeline/gates';
import type { Controller } from '../../src/model/controller';
import { parseId, type InjuryId } from '../../src/core/ids';
import { defaultSystems } from '../../src/systems';
import { startDefaultGame } from '../systems/calendar/default-game';

const PLAYER: Controller = { kind: 'human', playerId: 'local-player' };
const AS_PLAYER = { kind: 'controller', controller: PLAYER } as const;
const SKIP_DAYS = 30;
const MIN_WORLD_INJURED = 3;
/** Most stops (cancelled shows and later injuries) the spec should clear in all, to stay quick. */
const MAX_STOPS = Number(process.env['MAX_STOPS'] ?? '2');

const SHOW_NIGHT = 'showNight';
const ROSTER = 'roster';

interface SkipOutcome {
  readonly daysAdvanced: number;
  readonly showsCancelled: number;
  readonly injuryStop: readonly GateHit[] | null;
}

/** True when every hit has this hint. */
function allHinted(hits: readonly GateHit[], hint: string): boolean {
  return hits.length > 0 && hits.every((hit) => hit.actionHint === hint);
}

function cancelShows(engine: Engine, hits: readonly GateHit[]): number {
  let cancelled = 0;
  for (const hit of hits) {
    if (hit.subject?.kind !== 'eventInstance') throw new Error('A show stop without a show');
    const result = engine.command(
      'calendar.cancelShow',
      { eventInstanceId: parseId('eventInstance', hit.subject.id) },
      PLAYER,
    );
    if (!result.ok) throw new Error(`Cancel refused: ${JSON.stringify(result.reasons)}`);
    cancelled += 1;
  }
  return cancelled;
}

/**
 * Skips up to `days` days, cancelling the player's shows on the way. Ends early on an own-injury
 * stop when `endOnInjury`; otherwise sees the injury (as the Roster button does) and carries on.
 * Returns null when a stop the spec does not handle comes up.
 */
async function skip(
  engine: Engine,
  days: number,
  endOnInjury: boolean,
): Promise<(SkipOutcome & { readonly injuriesSeen: number }) | null> {
  let left = days;
  let showsCancelled = 0;
  let injuriesSeen = 0;
  while (left > 0) {
    const result = await engine.advanceDays({ maxDays: left });
    if (result.failures.length > 0) throw new Error(JSON.stringify(result.failures));
    left -= result.daysAdvanced;
    if (result.stoppedBy.kind !== 'gate') break;
    const { hits } = result.stoppedBy;
    if (allHinted(hits, SHOW_NIGHT)) {
      showsCancelled += cancelShows(engine, hits);
    } else if (allHinted(hits, ROSTER)) {
      if (endOnInjury) {
        return { daysAdvanced: days - left, showsCancelled, injuryStop: hits, injuriesSeen };
      }
      acknowledgeAll(engine);
      injuriesSeen += 1;
    } else {
      return null;
    }
  }
  return { daysAdvanced: days - left, showsCancelled, injuryStop: null, injuriesSeen };
}

/** What the Injuries tab does when the Roster button opens it. */
function acknowledgeAll(engine: Engine): void {
  const report = engine.query('health.report', {}, AS_PLAYER);
  if (!report.ok) throw new Error('health.report refused');
  const ids: InjuryId[] = [...report.data.waitingForViewer];
  if (ids.length === 0) return;
  const done = engine.command('health.acknowledgeInjuries', { injuryIds: ids }, PLAYER);
  if (!done.ok) throw new Error(`Acknowledge refused: ${JSON.stringify(done.reasons)}`);
}

async function trySeed(seed: string): Promise<string | null> {
  const state = startDefaultGame({ seed, seasonPreset: '12m' });
  const engine = createEngine({ state, systems: defaultSystems });

  const first = await skip(engine, SKIP_DAYS, true);
  if (first?.injuryStop == null) return null;
  const [hit] = first.injuryStop;
  if (hit?.subject?.kind !== 'person') return null;
  const personId = parseId('person', hit.subject.id);

  const world = engine.query('health.report', {}, AS_PLAYER);
  if (!world.ok || world.data.rows.length < MIN_WORLD_INJURED) return null;
  const row = world.data.rows.find((candidate) => candidate.personId === personId);
  if (row?.daysRemaining == null) return null;
  acknowledgeAll(engine);

  const returnDays = row.daysRemaining + 1;
  const back = await skip(engine, returnDays, false);
  if (back?.daysAdvanced !== returnDays) return null;
  const stops = first.showsCancelled + back.showsCancelled + back.injuriesSeen;
  if (stops > MAX_STOPS) return null;
  const after = engine.query('health.profile', { personId }, AS_PLAYER);
  if (!after.ok || after.data?.current !== null) return null;

  return JSON.stringify(
    {
      seed,
      stoppedAfterDays: first.daysAdvanced,
      showsCancelledBeforeInjury: first.showsCancelled,
      reason: hit.reason,
      worker: row.name,
      injury: row.label,
      bodyPart: row.bodyPart,
      severity: row.severity,
      expectedReturn: row.expectedReturn,
      daysRemaining: row.daysRemaining,
      worldInjured: world.data.rows.length,
      returnSkipDays: returnDays,
      returnStops: { showsCancelled: back.showsCancelled, injuriesSeen: back.injuriesSeen },
    },
    null,
    2,
  );
}

const firstIndex = Number(process.argv[2] ?? '1');
const count = Number(process.argv[3] ?? '40');
for (let index = firstIndex; index < firstIndex + count; index += 1) {
  const seed = `health-e2e-${String(index)}`;
  const found = await trySeed(seed);
  process.stdout.write(found === null ? `${seed}: no\n` : `${found}\n`);
  if (found !== null) break;
}
