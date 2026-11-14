import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { LOAD_MS, renderContracts } from '@/test/contractsScreen';
import { aContractRow } from '../contractFixtures';
import { renewalWindowText } from './RenewAction';

const CONTRACTS = routes.game.contracts();

/** The tiny world's free agent: its last person, with a counter-offer to the player waiting. */
function freeAgent(): PersonId {
  const personId = tinyWorld().ids.people.at(-1);
  if (personId === undefined) throw new Error('The tiny world lost its people.');
  return personId;
}

function tinyWorldRingName(personId: PersonId): string {
  return tinyWorld().world.tables.people.require(personId).defaultRingName;
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

describe('Contracts › Free agents and the Negotiation Sheet', () => {
  it('lists the free agent with an ask and opens their talks, countered, with Accept, Revise and End', async () => {
    const rendered = renderContracts(`${CONTRACTS}?tab=free-agents`);
    const table = await screen.findByRole('grid', { name: 'Free agents' }, { timeout: LOAD_MS });
    const row = await within(table).findByRole(
      'row',
      { name: new RegExp(tinyWorldRingName(freeAgent()), 'u') },
      { timeout: LOAD_MS },
    );
    expect(within(row).getByRole('button', { name: /'s ask/u })).toBeInTheDocument();
    await rendered.user.click(within(row).getByRole('button', { name: 'Open talks' }));
    await waitFor(() => {
      expect(rendered.router.state.location.search).toMatch(/negotiation=neg_/u);
    });
    expect(
      await screen.findByRole('button', { name: 'Accept counter' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    const sheet = screen.getByRole('dialog');
    for (const name of ['Send revised offer', 'End talks']) {
      expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(sheet).getByText(/^Countered: answer by /u)).toBeInTheDocument();
  }, 30_000);

  it('"Use their ask" reads Likely to accept, and a much lower wage changes the label', async () => {
    const rendered = renderContracts(`${CONTRACTS}?tab=free-agents&person=${freeAgent()}`);
    // The sheet shows a loading line first, then the form in its place.
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Use their ask' }, { timeout: LOAD_MS }),
    );
    const sheet = screen.getByRole('dialog');
    const meter = await within(sheet).findByRole(
      'meter',
      { name: 'Their likely reaction' },
      { timeout: LOAD_MS },
    );
    await waitFor(
      () => {
        expect(meter).toHaveAttribute(
          'aria-valuetext',
          expect.stringMatching(/^Likely to accept/u),
        );
      },
      { timeout: LOAD_MS },
    );
    const wage = within(sheet).getByRole('textbox', {
      name: /^(Monthly wage|Fee per appearance)$/u,
    });
    await rendered.user.clear(wage);
    await rendered.user.type(wage, '1');
    await waitFor(
      () => {
        expect(meter).not.toHaveAttribute(
          'aria-valuetext',
          expect.stringMatching(/^Likely to accept/u),
        );
      },
      { timeout: LOAD_MS },
    );
  }, 30_000);

  it("shows a refused offer's field reason under that field", async () => {
    const rendered = renderContracts(`${CONTRACTS}?tab=free-agents&person=${freeAgent()}`, {
      cannedCommands: {
        'contracts.makeOffer': () => ({
          ok: false,
          reasons: [
            {
              code: 'contracts.badTerms',
              message: 'Contracts run 60 months at most',
              field: 'offer.lengthMonths',
            },
          ],
        }),
      },
    });
    await rendered.user.click(
      await screen.findByRole('button', { name: 'Submit offer' }, { timeout: LOAD_MS }),
    );
    const sheet = screen.getByRole('dialog');
    expect(
      await within(sheet).findByText('Contracts run 60 months at most', undefined, {
        timeout: LOAD_MS,
      }),
    ).toBeInTheDocument();
  }, 30_000);

  it('disables Renew outside the renewal window, with the reason written out', async () => {
    renderContracts(`${CONTRACTS}?tab=expiring`, {
      canned: {
        // The seat's own contract, 400 days from its end: the window opens at 180.
        'contracts.list': () => {
          const promotionId = useSessionStore.getState().seat?.promotionId;
          return promotionId === null || promotionId === undefined
            ? undefined
            : [aContractRow({ daysLeft: 400, promotionId })];
        },
      },
    });
    const table = await screen.findByRole(
      'grid',
      { name: 'Expiring contracts' },
      { timeout: LOAD_MS },
    );
    const row = await within(table).findByRole(
      'row',
      { name: /Mara Quill/u },
      { timeout: LOAD_MS },
    );
    expect(await within(row).findByRole('button', { name: 'Renew' })).toBeDisabled();
    expect(within(row).getByText(renewalWindowText(180))).toBeInTheDocument();
  }, 30_000);
});
