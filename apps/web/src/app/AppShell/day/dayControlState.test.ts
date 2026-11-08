import { describe, expect, it } from 'vitest';
import type { GateHit } from '@ringside/engine';
import { routes } from '../../routes';
import { deriveDayControl, GENERIC_GATE_LABEL, leadingGate } from './dayControlState';

const showGate: GateHit = {
  gateId: 'events.showNeedsBooking',
  reason: "Your show 'Harbor Lights Showdown' on 2031-03-14 has no card yet",
  subject: { kind: 'eventInstance', id: 'evi_harbor' },
  actionHint: 'booking',
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

  it('routes a show gate to booking, linking the event, and turns Skip off', () => {
    expect(deriveDayControl([showGate], idle)).toEqual({
      primary: {
        kind: 'gate',
        label: 'Go to show',
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
      actionHint: 'booking',
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
      primary: { kind: 'gate', label: GENERIC_GATE_LABEL, reason: unknown.reason, to: null },
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
