/**
 * The theme choice is hidden while dark is the only shipped theme (D-11), but its plumbing stays
 * so a light theme can return. This file pretends more themes are selectable and checks the
 * choice still works end to end.
 */
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { useSettingsStore } from '@/app/settings/settingsStore';
import type * as ThemeModule from '@/styles/theme';
import { resetSettingsForTest } from '@/test/settings';

vi.mock('@/styles/theme', async (importOriginal) => {
  const actual = await importOriginal<typeof ThemeModule>();
  return { ...actual, SELECTABLE_THEME_PREFERENCES: ['system', 'light', 'dark'] };
});

function renderSettings() {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/settings'],
    future: routerFutureFlags,
  });
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
}

beforeEach(() => {
  resetSettingsForTest();
});

describe('SettingsScreen theme choice', () => {
  it('offers the themes as a labelled radio group with previews', async () => {
    renderSettings();
    const themeGroup = await screen.findByRole('group', { name: 'Theme' });

    expect(within(themeGroup).getAllByRole('radio')).toHaveLength(3);
    expect(within(themeGroup).getByRole('radio', { name: 'Dark' })).toBeChecked();
  });

  it('sets data-theme="dark" when Dark is chosen and follows the device for Match device', async () => {
    const user = userEvent.setup();
    renderSettings();
    const themeGroup = await screen.findByRole('group', { name: 'Theme' });

    await user.click(within(themeGroup).getByRole('radio', { name: 'Match device' }));
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(useSettingsStore.getState().settings.theme).toBe('system');

    await user.click(within(themeGroup).getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(useSettingsStore.getState().settings.theme).toBe('dark');
  });
});
