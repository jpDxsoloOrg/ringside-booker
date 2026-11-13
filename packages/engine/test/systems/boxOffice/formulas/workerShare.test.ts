// Worker shares of the gate and the merch. Design: docs/design/box-office.md#worker-shares
import { describe, expect, it } from 'vitest';
import { findTraceNodes, type Traced } from '../../../../src/core/trace';
import { computeWorkerShare, type WorkerShareInputs } from '../../../../src/systems/boxOffice';
import { createEngineTunables, type EngineTunables } from '../../../../src/systems/tunables';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

const DEFAULTS = createEngineTunables();

function share(
  inputs: Partial<WorkerShareInputs> = {},
  tunables: EngineTunables = DEFAULTS,
): Traced<number> {
  const result = computeWorkerShare(
    {
      gross: 1_000_000,
      label: 'Gate',
      shares: [
        { name: 'Rex Vance', bp: 250 },
        { name: 'Mara Quill', bp: 0 },
        { name: 'Jo Tide', bp: 100 },
      ],
      ...inputs,
    },
    { tunables },
  );
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeWorkerShare', () => {
  it('adds a line for each worker with a share and checks the others', () => {
    const result = share();
    expect(result.value).toBe(35_000);
    expect(findTraceNodes(result.trace, 'add').map((node) => node.label)).toEqual([
      'Rex Vance 2.5% of the gate',
      'Jo Tide 1% of the gate',
    ]);
    expect(findTraceNodes(result.trace, 'branch')).toEqual([
      expect.objectContaining({ label: 'Mara Quill has a share of the gate', taken: false }),
    ]);
    expect(findTraceNodes(result.trace, 'min')[0]?.applied).toBe(false);
  });

  it('names the merch for merch shares', () => {
    const labels = findTraceNodes(share({ label: 'Merch' }).trace, 'add').map((node) => node.label);
    expect(labels[0]).toBe('Rex Vance 2.5% of the merch');
  });

  it('is 0 with no workers, no shares or no takings', () => {
    expect(share({ shares: [] }).value).toBe(0);
    expect(share({ shares: [{ name: 'Rex Vance', bp: 0 }] }).value).toBe(0);
    expect(share({ gross: 0 }).value).toBe(0);
  });

  it('rounds down to whole cents', () => {
    expect(share({ gross: 999, shares: [{ name: 'Rex Vance', bp: 250 }] }).value).toBe(24);
  });

  it('caps the shares at half the takings', () => {
    const result = share({
      shares: [
        { name: 'Rex Vance', bp: 10_000 },
        { name: 'Jo Tide', bp: 5_000 },
      ],
    });
    expect(result.value).toBe(500_000);
    expect(findTraceNodes(result.trace, 'min')[0]?.applied).toBe(true);
  });

  it('treats a cap of 0 as no shares at all, for the gate and the merch alike', () => {
    expect(share({}, createEngineTunables({ 'boxOffice.gate.workerShareCap': 0 })).value).toBe(0);
    expect(
      share({ label: 'Merch' }, createEngineTunables({ 'boxOffice.merch.workerShareCap': 0 }))
        .value,
    ).toBe(0);
    expect(share({}, createEngineTunables({ 'boxOffice.merch.workerShareCap': 0 })).value).toBe(
      35_000,
    );
  });

  it('pays every share in full at a cap of 1', () => {
    const tunables = createEngineTunables({ 'boxOffice.gate.workerShareCap': 1 });
    const result = share({ shares: [{ name: 'Rex Vance', bp: 10_000 }] }, tunables);
    expect(result.value).toBe(1_000_000);
  });
});
