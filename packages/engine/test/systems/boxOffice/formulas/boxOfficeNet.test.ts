// The box office net. Design: docs/design/box-office.md#box-office-net
import { describe, expect, it } from 'vitest';
import { inputOf, type Traced } from '../../../../src/core/trace';
import { computeBoxOfficeNet, type BoxOfficeNetInputs } from '../../../../src/systems/boxOffice';
import { expectSerialisable, expectTraceReplays } from '../../../support/trace';

function net(inputs: BoxOfficeNetInputs): Traced<number> {
  const result = computeBoxOfficeNet(inputs);
  expectTraceReplays(result);
  expectSerialisable(result);
  return result;
}

describe('computeBoxOfficeNet', () => {
  it('is 0 when nothing came in and nothing was paid', () => {
    expect(net({ grossGate: 0, gateShare: 0, rent: 0, grossMerch: 0, merchShare: 0 }).value).toBe(
      0,
    );
  });

  it('takes shares and rent off the gate and the merch, one labelled line each', () => {
    const result = net({
      grossGate: 1_000_000,
      gateShare: 25_000,
      rent: 400_000,
      grossMerch: 80_000,
      merchShare: 2_000,
    });
    expect(result.value).toBe(653_000);
    expect((result.trace.children ?? []).map((node) => node.label)).toEqual([
      'Ticket sales',
      "Workers' share of the gate",
      'Venue rent',
      'Merch sales',
      "Workers' share of the merch",
    ]);
  });

  it('goes below 0 when the rent is more than the show took', () => {
    expect(
      net({ grossGate: 100_000, gateShare: 0, rent: 250_000, grossMerch: 20_000, merchShare: 0 })
        .value,
    ).toBe(-130_000);
  });

  it('nests the Why? of each traced amount', () => {
    const result = net({
      grossGate: inputOf('Ticket sales', 500, undefined, 'money'),
      gateShare: 0,
      rent: inputOf('Venue rent', 200, undefined, 'money'),
      grossMerch: 50,
      merchShare: 0,
    });
    expect(result.value).toBe(350);
    const rentLine = (result.trace.children ?? []).find((node) => node.label === 'Venue rent');
    expect(rentLine?.children?.[0]?.kind).toBe('input');
  });
});
