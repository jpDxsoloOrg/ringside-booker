import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { GateHit } from '@ringside/engine';
import { routes } from '../../routes';
import {
  CONTRACTS_HINT,
  deriveDayControl,
  gateDestination,
  GENERIC_GATE_LABEL,
  leadingGate,
  ROSTER_HINT,
  setRosterInjuriesTabAvailable,
} from './dayControlState';

const showGate: GateHit = {
  gateId: 'shows.tonight',
  reason: 'Tonight: Harbor Lights Showdown',
  subject: { kind: 'eventInstance', id: 'evi_harbor' },
  actionHint: 'showNight',
};

const contractDecision: GateHit = {
  gateId: 'inbox.decisionWaiting',
  reason: 'A contract offer needs an answer',
  actionHint: 'inbox',
};

const disciplineDecision: GateHit = {
  gateId: 'inbox.disciplineWaiting',
  reason: 'A discipline call needs an answer',
  actionHint: 'inbox',
};

const idle = { advancing: false };

describe('deriveDayControl', () => {
  it('offers Next day and Skip when no gate is waiting', () => {
    expect(deriveDayControl([], idle)).toEqual({ primary: { kind: 'next' }, skipEnabled: true });
  });

  it('a viewer with no promotion has no gates, so still gets Next day', () => {
    // sim.pendingGates for an unemployed seat answers with no hits; the button needs nothing else.
    const state = deriveDayControl([], idle);
    expect(state.primary).toEqual({ kind: 'next' });
  });

  it('routes a show night gate to the show, linking the event, and turns Skip off', () => {
    expect(deriveDayControl([showGate], idle)).toEqual({
      primary: {
        kind: 'gate',
        label: 'Go to the show',
        phoneLabel: 'Tonight',
        reason: showGate.reason,
        to: `${routes.game.booking()}?event=evi_harbor`,
      },
      skipEnabled: false,
    });
  });

  it('goes to booking without an event when the gate names none', () => {
    const withoutSubject: GateHit = {
      gateId: showGate.gateId,
      reason: showGate.reason,
      actionHint: 'showNight',
    };
    const state = deriveDayControl([withoutSubject], idle);
    expect(state.primary).toMatchObject({ kind: 'gate', to: routes.game.booking() });
  });

  it('puts decisions ahead of a show, counting every decision waiting', () => {
    const state = deriveDayControl([showGate, contractDecision, disciplineDecision], idle);
    expect(state).toEqual({
      primary: {
        kind: 'gate',
        label: '2 decisions waiting',
        phoneLabel: '2 waiting',
        reason: contractDecision.reason,
        to: `${routes.game.inbox()}?filter=decisions`,
      },
      skipEnabled: false,
    });
  });

  it('says "1 decision waiting" for a single decision', () => {
    expect(deriveDayControl([contractDecision], idle).primary).toMatchObject({
      label: '1 decision waiting',
    });
  });

  it('gives a gate with an unknown hint a generic label, its reason and no link', () => {
    const unknown: GateHit = {
      gateId: 'drafts.pickDue',
      reason: 'Your draft pick is due',
      actionHint: 'draftRoom',
    };
    expect(deriveDayControl([unknown], idle)).toEqual({
      primary: {
        kind: 'gate',
        label: GENERIC_GATE_LABEL,
        phoneLabel: null,
        reason: unknown.reason,
        to: null,
      },
      skipEnabled: false,
    });
  });

  it('treats a gate with no hint the same way', () => {
    const bare: GateHit = { gateId: 'sim.repeatedFailure', reason: 'A step keeps failing' };
    expect(deriveDayControl([bare], idle).primary).toMatchObject({
      label: GENERIC_GATE_LABEL,
      reason: 'A step keeps failing',
      to: null,
    });
  });

  it('is busy, with Skip off, while days advance', () => {
    expect(deriveDayControl([], { advancing: true })).toEqual({
      primary: { kind: 'busy' },
      skipEnabled: false,
    });
    expect(deriveDayControl([showGate], { advancing: true }).primary).toEqual({ kind: 'busy' });
  });
});

describe('leadingGate', () => {
  it('keeps registration order among gates of equal rank', () => {
    const first: GateHit = { gateId: 'a.first', reason: 'First' };
    const second: GateHit = { gateId: 'b.second', reason: 'Second' };
    expect(leadingGate([first, second])).toBe(first);
  });

  it('ranks known hints ahead of unknown ones', () => {
    const unknown: GateHit = { gateId: 'a.first', reason: 'First', actionHint: 'elsewhere' };
    expect(leadingGate([unknown, showGate])).toBe(showGate);
  });
});

describe('gateDestination', () => {
  it('names Go to the show for a show night gate, and nothing for a gate no screen handles', () => {
    expect(gateDestination(showGate)).toEqual({
      label: 'Go to the show',
      to: `${routes.game.booking()}?event=evi_harbor`,
    });
    expect(gateDestination({ gateId: 'a.b', reason: 'Elsewhere', actionHint: 'draftRoom' })).toBe(
      null,
    );
  });
});

describe('the own-injury stop (roster hint)', () => {
  const injuryGate: GateHit = {
    gateId: 'health.ownWorkerInjured',
    reason: 'Big Joe was injured (Sprained ankle, out until Mar 14, 2031)',
    subject: { kind: 'person', id: 'per_0000000007' },
    actionHint: ROSTER_HINT,
  };

  afterEach(() => {
    setRosterInjuriesTabAvailable(false);
  });

  it('reads Roster and opens the roster’s Injuries tab when it is registered', () => {
    setRosterInjuriesTabAvailable(true);
    expect(deriveDayControl([injuryGate], idle)).toEqual({
      primary: {
        kind: 'gate',
        label: 'Roster',
        phoneLabel: null,
        reason: injuryGate.reason,
        to: `${routes.game.roster()}?tab=injuries`,
      },
      skipEnabled: false,
    });
  });

  it('opens the injured worker’s Health tab without the Injuries tab', () => {
    expect(gateDestination(injuryGate)).toEqual({
      label: 'Roster',
      to: `${routes.game.worker(parseId('person', 'per_0000000007'))}?tab=health`,
    });
  });

  it('falls back to everyone injured on the Workers list when the gate names nobody', () => {
    const withoutSubject: GateHit = {
      gateId: injuryGate.gateId,
      reason: injuryGate.reason,
      actionHint: ROSTER_HINT,
    };
    expect(gateDestination(withoutSubject)?.to).toBe(
      `${routes.game.workers()}?availability=injured`,
    );
  });

  it('waits behind decisions and a show night', () => {
    expect(leadingGate([injuryGate, showGate])).toBe(showGate);
    expect(leadingGate([injuryGate, contractDecision])).toBe(contractDecision);
    expect(leadingGate([injuryGate, { gateId: 'x', reason: 'Other', actionHint: 'other' }])).toBe(
      injuryGate,
    );
  });
});

describe('the contract stops (contracts hint)', () => {
  const expiringGate: GateHit = {
    gateId: 'contracts.expiringSoon',
    reason: 'Contract expiring soon: Big Joe (ends Mar 14, 2031) and 1 more',
    subject: { kind: 'employment', id: 'emp_0000000007' },
    actionHint: CONTRACTS_HINT,
  };
  const requestGate: GateHit = {
    gateId: 'contracts.releaseRequested',
    reason: 'Big Joe wants to leave',
    subject: { kind: 'employment', id: 'emp_0000000007' },
    actionHint: CONTRACTS_HINT,
  };
  const injuryGate: GateHit = {
    gateId: 'health.ownWorkerInjured',
    reason: 'Big Joe was injured',
    actionHint: ROSTER_HINT,
  };

  it('reads Contracts and opens the Expiring tab, where Mark all seen clears every notice', () => {
    expect(deriveDayControl([expiringGate], idle)).toEqual({
      primary: {
        kind: 'gate',
        label: 'Contracts',
        phoneLabel: null,
        reason: expiringGate.reason,
        to: `${routes.game.contracts()}?tab=expiring`,
      },
      skipEnabled: false,
    });
  });

  it('opens the worker who wants to leave on the Active tab, filtered to requests', () => {
    expect(gateDestination(requestGate)).toEqual({
      label: 'Contracts',
      to: `${routes.game.contracts()}?tab=active&wantsToLeave=1&employment=emp_0000000007`,
    });
  });

  it('still filters to requests when the gate names no contract', () => {
    const withoutSubject: GateHit = {
      gateId: requestGate.gateId,
      reason: requestGate.reason,
      actionHint: CONTRACTS_HINT,
    };
    expect(gateDestination(withoutSubject)?.to).toBe(
      `${routes.game.contracts()}?tab=active&wantsToLeave=1`,
    );
  });

  it('opens the talks of a waiting counter-offer on the Offers tab (ECO5-06)', () => {
    const counterGate: GateHit = {
      gateId: 'contracts.counterWaiting',
      reason: 'Counter-offer from Big Joe is waiting for your answer',
      subject: { kind: 'negotiation', id: 'neg_0000000003' },
      actionHint: CONTRACTS_HINT,
    };
    expect(gateDestination(counterGate)).toEqual({
      label: 'Contracts',
      to: `${routes.game.contracts()}?tab=offers&negotiation=neg_0000000003`,
    });
  });

  it('waits behind decisions, a show night and a new injury', () => {
    expect(leadingGate([expiringGate, showGate])).toBe(showGate);
    expect(leadingGate([requestGate, contractDecision])).toBe(contractDecision);
    expect(leadingGate([requestGate, injuryGate])).toBe(injuryGate);
    expect(leadingGate([{ gateId: 'x', reason: 'Other', actionHint: 'other' }, expiringGate])).toBe(
      expiringGate,
    );
  });
});
