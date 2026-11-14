import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsAlertRuleView } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import {
  ALERTS_FOR_PLAYERS,
  alertSettingsChange,
  NEWS_ALERT_NOTE,
  NewsAlertSheet,
  NewsAlertSheetView,
  STOP_SKIP_LABEL,
} from './NewsAlertSheet';
import type { NewsAlertChange, NewsAlertSettings } from './NewsAlertSheet';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

const RULES: readonly NewsAlertRuleView[] = [
  {
    id: 'frontPage',
    label: 'Front-page stories',
    description: 'The biggest stories in the wrestling world.',
    enabled: true,
    defaultOn: true,
  },
  {
    id: 'myRoster',
    label: 'My roster',
    description: 'Any story about someone under contract with me.',
    enabled: false,
    defaultOn: false,
  },
];

const SETTINGS: NewsAlertSettings = { rules: RULES, stopSkip: true };

function renderView({
  canEdit = true,
  onSave = vi.fn<(change: NewsAlertChange) => Promise<readonly string[] | null>>(async () => null),
}: {
  readonly canEdit?: boolean;
  readonly onSave?: (change: NewsAlertChange) => Promise<readonly string[] | null>;
} = {}) {
  const onClose = vi.fn();
  render(
    <NewsAlertSheetView
      open
      onClose={onClose}
      settings={SETTINGS}
      canEdit={canEdit}
      onSave={onSave}
    />,
  );
  return { onClose, onSave, user: userEvent.setup({ delay: null }) };
}

function sheet(): HTMLElement {
  return screen.getByRole('dialog', { name: 'News alerts' });
}

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('NewsAlertSheetView', () => {
  it('shows each rule with its saved state, then the stop switch, and the note', () => {
    renderView();
    const switches = within(sheet()).getAllByRole('switch');
    expect(switches.map((control) => control.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'true',
    ]);
    expect(within(sheet()).getByRole('switch', { name: 'My roster' })).toHaveAccessibleDescription(
      'Any story about someone under contract with me.',
    );
    expect(within(sheet()).getByRole('switch', { name: STOP_SKIP_LABEL })).toBeChecked();
    expect(within(sheet()).getByText(NEWS_ALERT_NOTE)).toBeInTheDocument();
  });

  it('saves only the switches that changed, then closes', async () => {
    const { user, onSave, onClose } = renderView();
    await user.click(within(sheet()).getByRole('switch', { name: 'My roster' }));
    await user.click(within(sheet()).getByRole('switch', { name: 'Front-page stories' }));
    // Turned on and off again: no change to send.
    await user.click(within(sheet()).getByRole('switch', { name: STOP_SKIP_LABEL }));
    await user.click(within(sheet()).getByRole('switch', { name: STOP_SKIP_LABEL }));
    await user.click(within(sheet()).getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      rules: { frontPage: false, myRoster: true },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the stop switch only when it changed', async () => {
    const { user, onSave } = renderView();
    await user.click(within(sheet()).getByRole('switch', { name: STOP_SKIP_LABEL }));
    await user.click(within(sheet()).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ rules: {}, stopSkip: false });
  });

  it('closes without saving when nothing changed', async () => {
    const { user, onSave, onClose } = renderView();
    await user.click(within(sheet()).getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a refusal's message and stays open", async () => {
    const { user, onClose } = renderView({
      onSave: async () => ['There is no news alert called "nope"'],
    });
    await user.click(within(sheet()).getByRole('switch', { name: 'My roster' }));
    await user.click(within(sheet()).getByRole('button', { name: 'Save' }));
    expect(await within(sheet()).findByRole('alert')).toHaveTextContent(
      'There is no news alert called "nope"',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('turns every switch off for a seat with no promotion, and says why', () => {
    renderView({ canEdit: false });
    expect(within(sheet()).getByText(ALERTS_FOR_PLAYERS)).toBeInTheDocument();
    for (const control of within(sheet()).getAllByRole('switch')) {
      expect(control).toBeDisabled();
    }
    expect(within(sheet()).getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('alertSettingsChange', () => {
  it('keeps only the differences from the saved settings', () => {
    expect(alertSettingsChange(SETTINGS, { rules: {}, stopSkip: null })).toBeNull();
    expect(
      alertSettingsChange(SETTINGS, { rules: { frontPage: true, myRoster: true }, stopSkip: true }),
    ).toEqual({ rules: { myRoster: true } });
  });
});

describe('NewsAlertSheet', () => {
  it("reads the seat's defaults from the engine and saves a change there", async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(fakeEngineState());
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const { host } = transport;
    const runCommand = host.command.bind(host);
    const commands: { name: string; args: unknown }[] = [];
    host.command = async (name, args) => {
      commands.push({ name, args });
      return runCommand(name, args);
    };
    const onClose = vi.fn();
    const user = userEvent.setup({ delay: null });
    render(
      <EngineProvider createTransport={() => transport}>
        <NewsAlertSheet open onClose={onClose} />
      </EngineProvider>,
    );

    const roster = await within(sheet()).findByRole(
      'switch',
      { name: 'My roster' },
      { timeout: LOAD_MS },
    );
    expect(within(sheet()).getByRole('switch', { name: 'Front-page stories' })).toBeChecked();
    expect(roster).not.toBeChecked();
    expect(within(sheet()).getByRole('switch', { name: STOP_SKIP_LABEL })).toBeChecked();

    await user.click(roster);
    await user.click(within(sheet()).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(commands).toEqual([{ name: 'news.setAlertRules', args: { rules: { myRoster: true } } }]);
    const { result: saved } = await host.query('news.alertRules', {});
    expect(saved.ok && saved.data.rules.find((rule) => rule.id === 'myRoster')?.enabled).toBe(true);
  });
});
