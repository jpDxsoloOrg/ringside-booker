// Asking terms and eligibility (ECO5-02). Design: docs/design/negotiation.md#asking-terms
import { describe, expect, it } from 'vitest';
import { addDays } from '../../../src/core/date';
import {
  ALREADY_WRITTEN_CODE,
  askingTermsFor,
  negotiationEligibility,
  REACH_TOO_LOW,
  REFUSES_RENEWAL_CODE,
  REFUSES_RENEWAL_MESSAGE,
  registerAskModifier,
  registerPatienceModifier,
  type AskingTermsRequest,
} from '../../../src/systems/negotiation';
import { createEngineTunables } from '../../../src/systems/tunables';
import { inputOf } from '../../../src/core/trace/helpers';
import { expectSerialisable, expectTraceContains, expectTraceReplays } from '../../support/trace';
import {
  defaultTunables,
  negotiationWorld,
  setMorale,
  type NegotiationWorld,
} from './negotiation-world';

function termsFor(
  setup: NegotiationWorld,
  request: Omit<AskingTermsRequest, 'promotionId' | 'date'> &
    Partial<Pick<AskingTermsRequest, 'promotionId'>>,
  tunables = defaultTunables(),
) {
  const terms = askingTermsFor(setup.world, tunables, {
    promotionId: setup.human,
    date: setup.today,
    ...request,
  });
  expectSerialisable(terms);
  return terms;
}

describe('askingTermsFor', () => {
  it('refuses to renew at or below the refusal morale, naming the tunable', () => {
    const setup = negotiationWorld();
    const personId = setup.person(setup.mine);
    setMorale(setup.world, setup.mine, -60);
    const refused = termsFor(setup, { personId, renewalOf: setup.mine });
    expect(refused.refusal).toEqual({
      code: REFUSES_RENEWAL_CODE,
      message: REFUSES_RENEWAL_MESSAGE,
    });
    expect(refused.renewalDecision?.value).toBe(false);
    expect(JSON.stringify(refused.renewalDecision?.trace)).toContain(
      'contracts.renewal.refuseMorale',
    );

    setMorale(setup.world, setup.mine, -59);
    const unhappy = termsFor(setup, { personId, renewalOf: setup.mine });
    expect(unhappy.refusal).toBeNull();
    expect(unhappy.renewalDecision?.value).toBe(true);
    // Unhappy: asks more, with a Morale line, and has less patience.
    expectTraceContains(unhappy.monthlyWage, {
      kind: 'multiply',
      label: 'Morale −59: unhappy here',
    });
    expect(unhappy.startPatience.value).toBe(2);
    setMorale(setup.world, setup.mine, 0);
    const content = termsFor(setup, { personId, renewalOf: setup.mine });
    expect(content.startPatience.value).toBe(3);
    // Compare before the current-deal floor, which can hide the premium.
    const beforeFloor = (wage: typeof content.monthlyWage): number => {
      const floor = wage.trace.children?.find((node) => node.kind === 'max');
      return floor?.kind === 'max' ? floor.before : wage.value;
    };
    expect(beforeFloor(unhappy.monthlyWage)).toBeGreaterThan(beforeFloor(content.monthlyWage));
  });

  it('only allows written when renewing a written deal above the written threshold', () => {
    const setup = negotiationWorld();
    const terms = termsFor(setup, { personId: setup.person(setup.mine), renewalOf: setup.mine });
    expect(terms.kind).toBe('written');
    expect(terms.allowedKinds.map((entry) => [entry.kind, entry.allowed])).toEqual([
      ['written', true],
      ['perAppearance', false],
    ]);
    expect(terms.allowedKinds[1]?.reasons[0]?.code).toBe(ALREADY_WRITTEN_CODE);
    // A per-appearance renewal may move to written.
    const fee = termsFor(setup, {
      personId: setup.person(setup.mineFee),
      renewalOf: setup.mineFee,
    });
    expect(fee.kind).toBe('perAppearance');
    expect(fee.allowedKinds.every((entry) => entry.allowed)).toBe(true);
    expect(fee.signingBonus.value).toBe(0);
    expect(fee.perAppearanceFee.value).toBeGreaterThanOrEqual(45_000);
  });

  it('allows only per-appearance deals below the written reach, and no exclusives', () => {
    const setup = negotiationWorld();
    const tunables = createEngineTunables({
      'contracts.kind.writtenMinReach': 100,
      'contracts.kind.exclusiveMinReach': 100,
    });
    const terms = termsFor(setup, { personId: setup.free }, tunables);
    expect(terms.bestKind).toBe('perAppearance');
    expect(terms.kind).toBe('perAppearance');
    expect(terms.exclusive).toBe(false);
    expect(terms.exclusiveAllowed).toBe(false);
    expect(terms.allowedKinds[0]).toMatchObject({ kind: 'written', allowed: false });
    expect(terms.allowedKinds[0]?.reasons[0]?.code).toBe(REACH_TOO_LOW);
  });

  it('asks a popular veteran for an appearance cap, and a loyal one for a long deal', () => {
    const setup = negotiationWorld();
    const terms = termsFor(setup, { personId: setup.veteran });
    expect(terms.appearanceCap?.value).toBe(24);
    expect(terms.preferredLengthMonths.value).toBe(36);
    expect(termsFor(setup, { personId: setup.free }).appearanceCap).toBeNull();
    expect(termsFor(setup, { personId: setup.free }).preferredLengthMonths.value).toBe(24);
    for (const traced of [terms.appearanceCap, terms.preferredLengthMonths]) {
      if (traced !== null) {
        expectTraceReplays(traced);
      }
    }
  });

  it('applies registered ask and patience modifiers', () => {
    const setup = negotiationWorld();
    const plain = termsFor(setup, { personId: setup.free });
    const removeAsk = registerAskModifier({
      id: 'test.rapport',
      order: 1,
      label: 'Rapport',
      compute: () => inputOf('Rapport with your booker', 0.5),
    });
    const removePatience = registerPatienceModifier({
      id: 'test.rapport',
      order: 1,
      label: 'Rapport',
      compute: () => inputOf('Rapport with your booker', 2),
    });
    try {
      const modified = termsFor(setup, { personId: setup.free });
      expectTraceContains(modified.monthlyWage, {
        kind: 'multiply',
        label: 'Rapport with your booker',
      });
      expect(modified.monthlyWage.value).toBeLessThan(plain.monthlyWage.value);
      expect(modified.startPatience.value).toBe(plain.startPatience.value + 2);
    } finally {
      removeAsk();
      removePatience();
    }
  });
});

describe('negotiationEligibility', () => {
  it('reads who may be approached from public facts only', () => {
    const setup = negotiationWorld();
    const tunables = defaultTunables();
    const situation = (personId: Parameters<typeof negotiationEligibility>[2]) =>
      negotiationEligibility(setup.world, tunables, personId, setup.human, setup.today);
    expect(situation(setup.free).situation).toBe('freeAgent');
    expect(situation(setup.retired)).toMatchObject({ situation: 'unavailable' });
    expect(situation(setup.rookie).reasons[0]?.message).toBe('Has not debuted yet');
    expect(situation(setup.person(setup.mine)).situation).toBe('yours');
    expect(situation(setup.person(setup.rivalFee)).situation).toBe('perAppearanceElsewhere');
    expect(situation(setup.signedPerson)).toMatchObject({
      situation: 'underContract',
      earliestStart: addDays(setup.today, 375),
    });
    expect(situation(setup.person(setup.rivalEnding))).toMatchObject({
      situation: 'endingSoonElsewhere',
      earliestStart: addDays(setup.today, 20),
    });
  });

  it('opens talks exactly at the approach window', () => {
    const setup = negotiationWorld();
    const personId = setup.person(setup.rivalLocked);
    const at = (days: number) =>
      negotiationEligibility(
        setup.world,
        createEngineTunables({ 'contracts.offer.approachWindowDays': days }),
        personId,
        setup.human,
        setup.today,
      ).situation;
    expect(at(199)).toBe('underContract');
    expect(at(200)).toBe('endingSoonElsewhere');
  });
});
