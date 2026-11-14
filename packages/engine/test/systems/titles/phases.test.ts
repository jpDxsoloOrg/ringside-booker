// The daily orphaned-champion rule, titles.vacateOrphaned (CRTV1-03).
// Design: docs/design/titles.md#orphaned-champions
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import type { TitleId } from '../../../src/core/ids';
import { isFullTrace } from '../../../src/core/trace/store';
import type { TraceNode } from '../../../src/core/trace/types';
import type { Employment } from '../../../src/model/entities/employment';
import { titleVacancyTraceRef, vacateOrphanedPhase } from '../../../src/systems/titles';
import type { DeepPartial } from '../../support';
import {
  openReignOf,
  reignsOf,
  runOneDay,
  storedTrace,
  TODAY,
  titleEngine,
  titleEvents,
  titleWorld,
} from './title-commands-world';

/** A contract that ended `daysAgo` days before today (released). */
function endedDaysAgo(daysAgo: number): DeepPartial<Employment> {
  return { status: 'released', endedOn: addDays(TODAY, -daysAgo) };
}

function only(index: number, daysAgo: number) {
  return (rosterIndex: number): DeepPartial<Employment> =>
    rosterIndex === index ? endedDaysAgo(daysAgo) : {};
}

function vacatedTitleIds(engine: Parameters<typeof titleEvents>[0]): TitleId[] {
  return titleEvents(engine)
    .filter((event) => event.type === 'title.vacated')
    .map((event) => (event.payload as { titleId: TitleId }).titleId);
}

function ruleLines(children: readonly TraceNode[] | undefined): [string, unknown][] {
  return (children ?? [])
    .filter((node) => node.kind === 'branch')
    .map((node) => [node.label, node.value]);
}

describe('titles.vacateOrphaned', () => {
  it('runs daily in the contracts group after the contract phases', () => {
    expect(vacateOrphanedPhase).toMatchObject({
      id: 'titles.vacateOrphaned',
      group: 'contracts',
      order: 90,
      cadence: { kind: 'daily' },
    });
  });

  it('leaves employed champions and a champion employed only by the parent promotion alone', async () => {
    const world = titleWorld();
    const engine = titleEngine(world);
    await runOneDay(engine);
    expect(titleEvents(engine)).toEqual([]);
    expect(openReignOf(engine, world.television)).toBeDefined();
    // Altura's wrestler 1 holds the Next Championship with no Altura Next contract.
    expect(openReignOf(engine, world.nextTitle)).toBeDefined();
  });

  it('keeps the title 6 days after the contract ended (grace 7)', async () => {
    const world = titleWorld({ employment: only(0, 6) });
    const engine = titleEngine(world);
    await runOneDay(engine);
    expect(openReignOf(engine, world.television)).toBeDefined();
    expect(titleEvents(engine)).toEqual([]);
  });

  it('vacates the title 7 days after the contract ended, with its Why?', async () => {
    const world = titleWorld({ employment: only(0, 7) });
    const engine = titleEngine(world);
    const reign = openReignOf(engine, world.television);
    if (reign === undefined) {
      expect.fail('setup');
    }
    await runOneDay(engine);
    expect(reignsOf(engine, world.television)).toEqual([
      expect.objectContaining({ id: reign.id, lostOn: TODAY, endReason: 'vacated' }),
    ]);
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      {
        titleId: world.television,
        promotionId: world.altura,
        reignId: reign.id,
        holderIds: reign.holderIds,
        reasonKey: 'orphaned',
        source: 'system',
      },
    ]);
    const trace = storedTrace(engine, titleVacancyTraceRef(reign.id));
    if (trace === null || !isFullTrace(trace)) {
      expect.fail('no vacancy trace');
    }
    expect(trace.trace).toMatchObject({
      kind: 'decision',
      label: 'How the reign ended',
      chosen: 'vacated',
      reason: 'A champion has been gone longer than the grace period',
      docRef: 'docs/design/titles.md#orphaned-champions',
    });
    expect(ruleLines(trace.trace.children)).toEqual([
      [
        `${reign.holderNamesAtTime[0] ?? ''} has had no contract with Altura Pro since 28 Jan 2026 (7 days)`,
        false,
      ],
    ]);
    expect(trace.trace.children?.find((node) => node.kind === 'tunable')).toMatchObject({
      key: 'titles.orphanGraceDays',
      value: 7,
    });
    // The champion's name is a line of its own that links to their profile.
    expect(trace.trace.children?.find((node) => node.kind === 'input')).toEqual({
      kind: 'input',
      label: reign.holderNamesAtTime[0],
      value: 'No contract for 7 days',
      ref: { kind: 'person', id: reign.holderIds[0] },
    });
  });

  it('vacates on the day the contract ends with grace 0', async () => {
    const world = titleWorld({ employment: only(0, 0) });
    const engine = titleEngine(world, { 'titles.orphanGraceDays': 0 });
    await runOneDay(engine);
    expect(vacatedTitleIds(engine)).toEqual([world.television]);
    const reign = reignsOf(engine, world.television)[0];
    const trace = reign === undefined ? null : storedTrace(engine, titleVacancyTraceRef(reign.id));
    expect(trace !== null && isFullTrace(trace) && ruleLines(trace.trace.children)).toEqual([
      [expect.stringMatching(/since 4 Feb 2026 \(left today\)$/), false],
    ]);
  });

  it('vacates a tag title whole when one holder is gone, naming both holders', async () => {
    const world = titleWorld({ tagHolders: [2, 3], employment: only(3, 10) });
    const engine = titleEngine(world);
    const reign = openReignOf(engine, world.tag);
    if (reign === undefined) {
      expect.fail('setup');
    }
    await runOneDay(engine);
    expect(openReignOf(engine, world.tag)).toBeUndefined();
    expect(vacatedTitleIds(engine)).toEqual([world.tag]);
    const trace = storedTrace(engine, titleVacancyTraceRef(reign.id));
    const [stays, gone] = reign.holderNamesAtTime;
    expect(trace !== null && isFullTrace(trace) && ruleLines(trace.trace.children)).toEqual([
      [`${stays ?? ''} works for Altura Pro`, true],
      [`${gone ?? ''} has had no contract with Altura Pro since 25 Jan 2026 (10 days)`, false],
    ]);
  });

  it('vacates a rival promotion’s title the same way', async () => {
    const world = titleWorld({ bravoEmployment: only(0, 9) });
    const engine = titleEngine(world);
    await runOneDay(engine);
    expect(openReignOf(engine, world.bravoTitle)).toBeUndefined();
    expect(titleEvents(engine).map((event) => event.payload)).toEqual([
      expect.objectContaining({
        titleId: world.bravoTitle,
        promotionId: world.bravo,
        reasonKey: 'orphaned',
        source: 'system',
      }),
    ]);
  });

  it('names the parent promotion when the title has one', async () => {
    const world = titleWorld({ employment: only(1, 8) });
    const engine = titleEngine(world);
    const reign = openReignOf(engine, world.nextTitle);
    if (reign === undefined) {
      expect.fail('setup');
    }
    await runOneDay(engine);
    expect(vacatedTitleIds(engine)).toEqual([world.nextTitle]);
    const trace = storedTrace(engine, titleVacancyTraceRef(reign.id));
    expect(trace !== null && isFullTrace(trace) && ruleLines(trace.trace.children)).toEqual([
      [expect.stringMatching(/no contract with Altura Next or its parent since/), false],
    ]);
  });

  it('ignores retired titles', async () => {
    const world = titleWorld({ legendsHolder: 4, employment: only(4, 30) });
    const engine = titleEngine(world);
    await runOneDay(engine);
    expect(openReignOf(engine, world.legends)).toBeDefined();
    expect(titleEvents(engine)).toEqual([]);
  });

  it('vacates once: the next day finds nothing to do', async () => {
    const world = titleWorld({ employment: only(0, 7) });
    const engine = titleEngine(world);
    await runOneDay(engine);
    await runOneDay(engine);
    expect(vacatedTitleIds(engine)).toEqual([world.television]);
  });
});
