import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandName } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { LOAD_MS, renderFinances } from '@/test/financesScreen';
import type { RenderedFinances } from '@/test/financesScreen';

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

const POLICIES_URL = routes.game.finances({ tab: 'policies' });

interface Issued {
  readonly name: CommandName;
  readonly args: unknown;
}

/** Records every command; with `refusal`, the engine never sees them and they are refused. */
function watchCommands(rendered: RenderedFinances, refusal?: string): Issued[] {
  const issued: Issued[] = [];
  const { host } = rendered.transport;
  const runCommand = host.command.bind(host);
  host.command = async (name, args) => {
    issued.push({ name, args });
    if (refusal !== undefined) {
      return {
        revision: 0,
        result: { ok: false, reasons: [{ code: 'samePolicy', message: refusal }] },
      };
    }
    return runCommand(name, args);
  };
  return issued;
}

async function findArea(name: string): Promise<HTMLElement> {
  return screen.findByRole('group', { name: `${name} level` }, { timeout: LOAD_MS });
}

describe('PoliciesTab', () => {
  it('shows the three areas, each level with its monthly cost and a Why?', async () => {
    await renderFinances(POLICIES_URL);
    for (const area of ['Catering', 'Travel', 'Medical']) {
      const group = await findArea(area);
      expect(within(group).getAllByRole('radio')).toHaveLength(4);
      expect(within(group).getByRole('radio', { name: 'Premium' })).toBeInTheDocument();
      expect(within(group).getAllByText(/\/month$/u)).toHaveLength(4);
      expect(within(group).getByText("(today's level)")).toBeInTheDocument();
      expect(
        within(group).getByRole('button', {
          name: new RegExp(`^Why is ${area} at Premium, a month `, 'u'),
        }),
      ).toBeInTheDocument();
    }
  });

  it('runs finance.setPolicy for the level picked, announces it and prices the levels again', async () => {
    const rendered = await renderFinances(POLICIES_URL);
    const issued = watchCommands(rendered);
    const group = await findArea('Medical');
    const previewsBefore = rendered.argsOf('finance.policyPreview').length;

    await rendered.user.click(within(group).getByRole('radio', { name: 'Premium' }));
    await waitFor(() => {
      expect(issued).toEqual([
        {
          name: 'finance.setPolicy',
          args: { promotionId: rendered.promotionId, area: 'medical', level: 3 },
        },
      ]);
    });
    await waitFor(
      () => {
        expect(within(group).getByRole('radio', { name: 'Premium' })).toBeChecked();
      },
      { timeout: LOAD_MS },
    );
    expect(rendered.argsOf('finance.policyPreview').length).toBeGreaterThan(previewsBefore);
    expect(
      await screen.findByText('Medical policy set to Premium', {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('shows a refusal under the choice and keeps the level', async () => {
    const rendered = await renderFinances(POLICIES_URL);
    watchCommands(rendered, 'Travel is already Basic');
    const group = await findArea('Travel');
    const checkedBefore = within(group)
      .getAllByRole('radio')
      .find((radio) => radio instanceof HTMLInputElement && radio.checked);

    await rendered.user.click(within(group).getByRole('radio', { name: 'Good' }));
    expect(
      await screen.findByText('Travel is already Basic', {}, { timeout: LOAD_MS }),
    ).toHaveAttribute('role', 'alert');
    expect(checkedBefore).toBeChecked();
  });
});
