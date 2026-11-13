// The roster's Injuries tab (WRK6-06).
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { injuryTraceRef, parseContentKey, parseGameDate, parseId } from '@ringside/engine';
import type { InjuredRow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState, healthFakeState } from '@/test/fakeEngine';
import { InjuriesList, InjuriesTab, injuriesToAcknowledge } from './InjuriesTab';
import { INJURIES_TAB } from './registerInjuriesTab';

const LOAD_MS = 10_000;
const ACKNOWLEDGE = 'health.acknowledgeInjuries';

function transportFor(state = healthFakeState().state): InProcessTransport {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  return transport;
}

function renderWith(transport: InProcessTransport, ui: ReactNode) {
  return render(
    <EngineProvider createTransport={() => transport}>
      <MemoryRouter future={routerFutureFlags}>{ui}</MemoryRouter>
    </EngineProvider>,
  );
}

async function findList(): Promise<HTMLElement> {
  return screen.findByRole('grid', { name: /^Injured workers/ }, { timeout: LOAD_MS });
}

const ROW: InjuredRow = {
  injuryId: parseId('injury', 'inj_0000000101'),
  personId: parseId('person', 'per_0000000101'),
  kindKey: parseContentKey('injury.sprained-ankle'),
  label: 'Sprained ankle',
  bodyPart: 'legs',
  severity: 'minor',
  since: parseGameDate('2027-02-19'),
  expectedReturn: parseGameDate('2027-03-05'),
  returnedOn: null,
  daysOut: 14,
  daysRemaining: 11,
  canWorkAngles: true,
  source: 'segment',
  segmentId: null,
  durationTraceRef: injuryTraceRef(parseId('injury', 'inj_0000000101')),
  conditionLoss: 2,
  conditionLossTraceRef: null,
  chanceTraceRef: null,
  pendingNotice: true,
  name: 'Marlo Quint',
  imageRef: null,
  employer: null,
  roles: ['wrestler'],
};

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('the Injuries tab', () => {
  it('is registered after the role tabs, at its reserved order', () => {
    expect(INJURIES_TAB).toMatchObject({ id: 'injuries', label: 'Injuries', order: 70 });
  });

  it('lists only your promotion’s injured, links the name to the Health tab, and says New', async () => {
    const { state, people } = healthFakeState();
    renderWith(transportFor(state), <InjuriesTab />);

    const list = await findList();
    const rows = list.querySelectorAll<HTMLElement>('tbody tr[data-row-id]');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error('expected a row');
    const link = within(row).getByRole('link');
    expect(link).toHaveAttribute('href', `${routes.game.worker(people.injured)}?tab=health`);
    expect(within(row).getByText('Test arm injury')).toBeInTheDocument();
    expect(within(row).getByText('Severe')).toBeInTheDocument();
    expect(within(row).getByText('11 days left')).toBeInTheDocument();
  });

  it('marks the waiting injuries as seen once, however often it renders', async () => {
    const transport = transportFor();
    const spy = vi.spyOn(transport.host, 'command');
    const { rerender } = renderWith(transport, <InjuriesTab />);
    await findList();
    await waitFor(() => {
      expect(spy.mock.calls.filter(([name]) => name === ACKNOWLEDGE)).toHaveLength(1);
    });
    rerender(
      <EngineProvider createTransport={() => transport}>
        <MemoryRouter future={routerFutureFlags}>
          <InjuriesTab />
        </MemoryRouter>
      </EngineProvider>,
    );
    await findList();
    // The player's own injury and the computer's waiting one (nobody human employs that worker,
    // so anyone may clear it): one call with both.
    const calls = spy.mock.calls.filter(([name]) => name === ACKNOWLEDGE);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({ injuryIds: [expect.any(String), expect.any(String)] });
  });

  it('says nobody is injured', async () => {
    renderWith(transportFor(fakeEngineState()), <InjuriesTab />);
    expect(
      await screen.findByRole('heading', { name: 'Nobody is injured' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('says so when you run no promotion', () => {
    renderWith(transportFor(), <InjuriesTab promotionId={null} />);
    expect(screen.getByRole('heading', { name: "You don't run a promotion" })).toBeInTheDocument();
  });
});

describe('InjuriesList', () => {
  it('puts a Why? for the time out beside the days left when the breakdown is kept', () => {
    renderWith(transportFor(), <InjuriesList rows={[ROW]} layout="table" />);
    expect(screen.getByText('11 days left')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Why is Marlo Quint out for 14 days?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('leaves the Why? out once the breakdown is gone', () => {
    renderWith(transportFor(), <InjuriesList rows={[{ ...ROW, durationTraceRef: null }]} />);
    expect(screen.queryByRole('button', { name: /^Why is/ })).toBeNull();
  });
});

describe('injuriesToAcknowledge', () => {
  it('sends the report’s waiting ids and any row still new, once each', () => {
    const other = parseId('injury', 'inj_0000000102');
    expect(
      injuriesToAcknowledge({
        asOf: parseGameDate('2027-02-22'),
        rows: [ROW],
        waitingForViewer: [other, ROW.injuryId],
      }),
    ).toEqual([other, ROW.injuryId]);
  });
});
