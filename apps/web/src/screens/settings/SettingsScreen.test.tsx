import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_FORMAT_VERSION, ENGINE_VERSION } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { appRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { settingsLinkState } from '@/app/settings/settingsNavigation';
import { DEFAULT_SETTINGS } from '@/app/settings/settingsSchema';
import {
  browserSettingsStorage,
  initializeSettings,
  SETTINGS_STORAGE_KEY,
  useSettingsStore,
} from '@/app/settings/settingsStore';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { memorySettingsStorage, resetSettingsForTest } from '@/test/settings';
import { SETTINGS_NOT_REMEMBERED_NOTE } from './SettingsScreen';

interface RenderOptions {
  /** The location state the settings link carried. */
  readonly state?: unknown;
  /** Render inside an engine provider, so the About panel can ping the engine. */
  readonly withEngine?: boolean;
}

function renderSettings({ state = null, withEngine = false }: RenderOptions = {}) {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [{ pathname: '/settings', state }],
    future: routerFutureFlags,
  });
  const app = <RouterProvider router={router} future={routerProviderFutureFlags} />;
  if (withEngine) {
    const transport = createInProcessTransport(fakeEngineFactory());
    render(<EngineProvider createTransport={() => transport}>{app}</EngineProvider>);
  } else {
    render(app);
  }
  return router;
}

async function findHeading() {
  return screen.findByRole('heading', { level: 1, name: 'Settings' });
}

function rootElement(): HTMLElement {
  return document.documentElement;
}

beforeEach(() => {
  resetSettingsForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SettingsScreen', () => {
  it('shows the dark theme and offers no theme choice while dark is the only theme', async () => {
    renderSettings();
    await findHeading();

    expect(rootElement().dataset['theme']).toBe('dark');
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
  });

  it('keeps the dark theme when a theme that does not ship was stored', async () => {
    resetSettingsForTest(memorySettingsStorage(JSON.stringify({ theme: 'light' })));
    renderSettings();
    await findHeading();

    expect(rootElement().dataset['theme']).toBe('dark');
  });

  it('sets --ui-scale when the slider moves to 1.25', async () => {
    renderSettings();
    await findHeading();

    const slider = screen.getByRole('slider', { name: 'UI scale' });
    fireEvent.change(slider, { target: { value: '1.25' } });

    expect(rootElement().style.getPropertyValue('--ui-scale')).toBe('1.25');
    expect(slider).toHaveAttribute('aria-valuetext', '125%');
    expect(screen.getByText('125%', { selector: 'output' })).toBeInTheDocument();
    expect(useSettingsStore.getState().settings.uiScale).toBe(1.25);
  });

  it('steps the scale with the − and + buttons, stopping at the ends, and resets it', async () => {
    const user = userEvent.setup();
    renderSettings();
    await findHeading();

    const decrease = screen.getByRole('button', { name: 'Decrease UI scale' });
    const increase = screen.getByRole('button', { name: 'Increase UI scale' });
    const resetScale = screen.getByRole('button', { name: 'Reset scale' });
    expect(resetScale).toBeDisabled();

    await user.click(increase);
    expect(rootElement().style.getPropertyValue('--ui-scale')).toBe('1.05');
    expect(resetScale).toBeEnabled();

    for (let step = 0; step < 5; step += 1) await user.click(decrease);
    expect(useSettingsStore.getState().settings.uiScale).toBe(0.8);
    expect(decrease).toBeDisabled();

    await user.click(resetScale);
    expect(useSettingsStore.getState().settings.uiScale).toBe(1);
    expect(rootElement().style.getPropertyValue('--ui-scale')).toBe('1');
  });

  it('labels its radio groups and operates them from the keyboard', async () => {
    const user = userEvent.setup();
    renderSettings();
    await findHeading();

    const motion = screen.getByRole('group', { name: 'Animations' });
    const money = screen.getByRole('group', { name: 'Money' });
    expect(within(motion).getAllByRole('radio')).toHaveLength(3);
    expect(within(money).getAllByRole('radio')).toHaveLength(2);
    expect(within(motion).getByRole('radio', { name: 'Match device' })).toBeChecked();

    within(motion).getByRole('radio', { name: 'Match device' }).focus();
    await user.keyboard('{ArrowDown}');

    const reduce = within(motion).getByRole('radio', { name: 'Reduce motion' });
    expect(reduce).toBeChecked();
    expect(reduce).toHaveFocus();
    expect(rootElement().getAttribute('data-reduced-motion')).toBe('on');

    await user.keyboard('{ArrowDown}');
    expect(within(motion).getByRole('radio', { name: 'Full motion' })).toBeChecked();
    expect(rootElement().getAttribute('data-reduced-motion')).toBe('off');

    within(money).getByRole('radio', { name: 'Compact' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(within(money).getByRole('radio', { name: 'Full' })).toBeChecked();
    expect(useSettingsStore.getState().settings.moneyStyle).toBe('full');
  });

  it('shows the money style examples', async () => {
    renderSettings();
    await findHeading();

    const money = screen.getByRole('group', { name: 'Money' });
    expect(within(money).getByRole('radio', { name: 'Compact' })).toHaveAccessibleDescription(
      '$1.2M',
    );
    expect(within(money).getByRole('radio', { name: 'Full' })).toHaveAccessibleDescription(
      '$1,234,567',
    );
  });

  it('resets every setting after confirming', async () => {
    const user = userEvent.setup();
    renderSettings();
    await findHeading();

    fireEvent.change(screen.getByRole('slider', { name: 'UI scale' }), {
      target: { value: '1.5' },
    });
    await user.click(screen.getByRole('radio', { name: 'Reduce motion' }));
    await user.click(screen.getByRole('radio', { name: 'Full' }));
    expect(useSettingsStore.getState().settings).not.toEqual(DEFAULT_SETTINGS);

    await user.click(screen.getByRole('button', { name: 'Reset all settings' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Reset all settings?' });
    await user.click(within(dialog).getByRole('button', { name: 'Reset settings' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(rootElement().style.getPropertyValue('--ui-scale')).toBe('1');
    expect(rootElement().hasAttribute('data-reduced-motion')).toBe(false);
    expect(screen.getByRole('radio', { name: 'Match device' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Compact' })).toBeChecked();
  });

  it('keeps the settings when the reset is cancelled', async () => {
    const user = userEvent.setup();
    renderSettings();
    await findHeading();

    await user.click(screen.getByRole('radio', { name: 'Full' }));
    await user.click(screen.getByRole('button', { name: 'Reset all settings' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(useSettingsStore.getState().settings.moneyStyle).toBe('full');
  });

  it('works with a throwing localStorage and says the settings will not be remembered', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: the operation is insecure');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: the operation is insecure');
    });
    initializeSettings(browserSettingsStorage());
    const user = userEvent.setup();
    renderSettings();
    await findHeading();

    expect(screen.getByText(SETTINGS_NOT_REMEMBERED_NOTE)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Reduce motion' }));
    expect(rootElement().getAttribute('data-reduced-motion')).toBe('on');
  });

  it('does not show the note when storage works', async () => {
    initializeSettings(browserSettingsStorage());
    renderSettings();
    await findHeading();

    expect(screen.queryByText(SETTINGS_NOT_REMEMBERED_NOTE)).toBeNull();
    act(() => {
      useSettingsStore.getState().update({ moneyStyle: 'full' });
    });
    expect(window.localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain('"full"');
    window.localStorage.clear();
  });

  it('shows the app, engine and save format versions', async () => {
    renderSettings({ withEngine: true });
    await findHeading();

    const about = screen.getByRole('region', { name: 'About' });
    const valueOf = (term: string) => within(about).getByText(term).nextElementSibling;
    expect(valueOf('App version')).toHaveTextContent(__APP_VERSION__);
    await waitFor(() => {
      expect(valueOf('Engine version')).toHaveTextContent(ENGINE_VERSION);
    });
    expect(valueOf('Save format')).toHaveTextContent(`Version ${String(CURRENT_FORMAT_VERSION)}`);
  });

  it('says the engine version is not available without an engine', async () => {
    renderSettings();
    await findHeading();

    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('goes back to the title screen by default', async () => {
    const user = userEvent.setup();
    const router = renderSettings();
    await findHeading();

    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/');
  });

  it('goes back to the game screen it was opened from', async () => {
    renderSettings({ state: settingsLinkState('/game/roster') });
    await findHeading();

    expect(screen.getByRole('link', { name: 'Back to game' })).toHaveAttribute(
      'href',
      '/game/roster',
    );
  });
});
