// The weekly storyline detail prune (CRTV3-02). Design: docs/design/storylines.md#heat-decay
import { describe, expect, it } from 'vitest';
import { addDays, type GameDate } from '../../../src/core/date';
import { createRuntime } from '../../../src/core/pipeline/runtime';
import { runStep } from '../../../src/core/pipeline/runStep';
import { constantOf } from '../../../src/core/trace/helpers';
import { isFullTrace } from '../../../src/core/trace/store';
import {
  pruneStorylineDetail,
  storylineHeatTraceRef,
  storylineStarterTraceRef,
} from '../../../src/systems/storylines';
import { TEST_START_DATE } from '../../support';
import { storylineWorld } from './storyline-world';

describe('storylines.pruneDetail', () => {
  it("turns an ended storyline's Why?s into summaries once it is past the detail window", () => {
    const built = storylineWorld();
    const runtime = createRuntime({ world: built.world });
    // storylines[0] is active; storylines[2] ended on day 3.
    const active = built.ids.storylines[0]!;
    const ended = built.ids.storylines[2]!;
    const refs = [
      storylineHeatTraceRef(active),
      storylineHeatTraceRef(ended),
      storylineStarterTraceRef(ended),
    ];
    runStep(runtime, 'test.record', { kind: 'phase', id: 'test.record' }, (ctx) => {
      for (const ref of refs) {
        ctx.recordTrace(ref, TEST_START_DATE, constantOf('Heat', 30, 'Test heat'));
      }
    });
    const prune = (date: GameDate): number => {
      let looked = 0;
      runStep(
        runtime,
        'test.prune',
        { kind: 'phase', id: 'test.prune' },
        (ctx) => {
          looked = pruneStorylineDetail(ctx);
        },
        { date },
      );
      return looked;
    };
    // 28 days after it ended: still inside the window.
    expect(prune(addDays(TEST_START_DATE, 31))).toBe(0);
    expect(refs.every((ref) => isFullTrace(runtime.traces.get(ref)!))).toBe(true);
    expect(prune(addDays(TEST_START_DATE, 40))).toBe(1);
    const [activeHeat, endedHeat, endedStarter] = refs.map((ref) => runtime.traces.get(ref)!);
    expect(isFullTrace(activeHeat!)).toBe(true);
    expect(isFullTrace(endedHeat!)).toBe(false);
    expect(isFullTrace(endedStarter!)).toBe(false);
  });
});
