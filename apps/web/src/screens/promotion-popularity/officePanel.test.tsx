import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import {
  showChangeWithStatus,
  smallUntelevisedShowChange,
} from '@/screens/dev-gallery/fixtures/popularityShowChange';
import { renderOfficePanel } from '@/test/officePanel';
import { FANS_PANEL_ID, FANS_PANEL_TITLE } from './officePanel';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

/** The tiny world's completed show, the player's last. */
const LAST_SHOW = parseId('eventInstance', 'evi_0000000001');

afterEach(() => {
  useSessionStore.getState().clear();
});

describe('the "Fans after your last show" panel (DAY2-06)', () => {
  it("lists where the player's last show won or lost fans, with a link to its results", async () => {
    await renderOfficePanel(FANS_PANEL_ID, {
      engine: {
        showChanges: new Map([
          [LAST_SHOW, { ...smallUntelevisedShowChange, eventInstanceId: LAST_SHOW }],
        ]),
      },
    });

    const panel = await screen.findByRole(
      'region',
      { name: FANS_PANEL_TITLE },
      { timeout: LOAD_MS },
    );
    expect(within(panel).getByText(smallUntelevisedShowChange.showName)).toBeInTheDocument();
    expect(within(panel).getAllByRole('button', { name: /^Why is /u }).length).toBeGreaterThan(0);
    expect(within(panel).getByRole('link', { name: 'See the results' })).toHaveAttribute(
      'href',
      routes.game.showResults(LAST_SHOW),
    );
  });

  it("draws nothing when the last show changed no one's popularity", async () => {
    const { view } = await renderOfficePanel(FANS_PANEL_ID, {
      engine: {
        showChanges: new Map([
          [LAST_SHOW, { ...showChangeWithStatus('notApplied'), eventInstanceId: LAST_SHOW }],
        ]),
      },
    });
    // The frame is drawn, then stays empty, so the Office shows no gap.
    await waitFor(
      () => {
        expect(view.container.querySelector('[data-office-panel]')).not.toBeNull();
      },
      { timeout: LOAD_MS },
    );
    expect(screen.queryByRole('region', { name: FANS_PANEL_TITLE })).toBeNull();
    expect(view.container.querySelector('[data-office-panel]')).toBeEmptyDOMElement();
  });
});
