import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { ContractRow } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { LOAD_MS, renderContracts } from '@/test/contractsScreen';
import type { RenderedContracts } from '@/test/contractsScreen';
import { formatGameDate } from '@/components/format';
import { CONTRACT_KIND_LABELS, NO_END_DATE } from './contractLabels';
import { aContractRow, anAnswerPreview, anOwnDetail, FIXTURE_EMPLOYMENT } from './contractFixtures';
import { SEVERANCE_CHANGED_TEXT } from './ReleaseDialog';

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

const CONTRACTS = routes.game.contracts();

async function activeRows(rendered: RenderedContracts): Promise<ContractRow[]> {
  const answer = await rendered.transport.host.query('contracts.list', { tab: 'active' });
  if (!answer.result.ok) throw new Error('contracts.list refused');
  return answer.result.data;
}

async function findTable(name: string): Promise<HTMLElement> {
  return screen.findByRole('grid', { name }, { timeout: LOAD_MS });
}

async function openReleaseConfirm(rendered: RenderedContracts): Promise<{
  confirm: HTMLElement;
  target: ContractRow;
}> {
  const table = await findTable('Active contracts');
  const rows = await activeRows(rendered);
  const target = rows.find((row) => row.role === 'wrestler') ?? rows[0];
  if (target === undefined) throw new Error('The tiny world has contracts');
  await rendered.user.click(
    await within(table).findByRole('row', { name: new RegExp(target.ringName, 'u') }),
  );
  const sheet = await screen.findByRole('dialog', { name: target.ringName }, { timeout: LOAD_MS });
  await rendered.user.click(
    await within(sheet).findByRole('button', { name: 'Release' }, { timeout: LOAD_MS }),
  );
  const confirm = await screen.findByRole('alertdialog', { name: `Release ${target.ringName}?` });
  await within(confirm).findByText('Cash after', undefined, { timeout: LOAD_MS });
  return { confirm, target };
}

describe('ContractsScreen', () => {
  it('switches tabs and keeps the tab in the URL', async () => {
    const rendered = renderContracts();
    await findTable('Active contracts');
    await rendered.user.click(screen.getByRole('tab', { name: 'Expiring' }));
    await waitFor(() => {
      expect(rendered.router.state.location.search).toContain('tab=expiring');
    });
    await rendered.user.click(screen.getByRole('tab', { name: 'Ended' }));
    await waitFor(() => {
      expect(rendered.router.state.location.search).toContain('tab=ended');
    });
    expect(
      await screen.findByText('No contracts have ended yet', undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('lists each active contract with its kind, wage and end date, under a counts line', async () => {
    const rendered = renderContracts();
    const table = await findTable('Active contracts');
    const rows = await activeRows(rendered);
    const first = rows[0];
    if (first === undefined) throw new Error('The tiny world has contracts');
    const row = await within(table).findByRole(
      'row',
      { name: new RegExp(first.ringName, 'u') },
      { timeout: LOAD_MS },
    );
    expect(within(row).getByText(CONTRACT_KIND_LABELS[first.kind])).toBeInTheDocument();
    expect(
      within(row).getByText(first.endsOn === null ? NO_END_DATE : formatGameDate(first.endsOn)),
    ).toBeInTheDocument();
    expect(within(row).getByText(/\/mo|per show/u)).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`^${String(rows.length)} contracts · .* a month · `, 'u')),
    ).toBeInTheDocument();
  });

  it('shows perks and titles as badges', async () => {
    renderContracts(CONTRACTS, {
      canned: {
        'contracts.list': () => [
          aContractRow({
            perks: ['ironClad', 'travelCovered'],
            titles: [
              {
                id: parseId('title', 'tit_0000000001'),
                name: 'World Title',
              },
            ],
          }),
        ],
      },
    });
    const table = await findTable('Active contracts');
    const row = await within(table).findByRole(
      'row',
      { name: /Mara Quill/u },
      { timeout: LOAD_MS },
    );
    expect(within(row).getByText('Iron-clad')).toBeInTheDocument();
    expect(within(row).getByText('Travel covered')).toBeInTheDocument();
    expect(within(row).getByText('World Title')).toBeInTheDocument();
    expect(within(row).getByText(/^\$8(,000|K)\/mo$/u)).toBeInTheDocument();
  });

  it('releases from the sheet with the severance the player saw', async () => {
    const rendered = renderContracts();
    const { confirm, target } = await openReleaseConfirm(rendered);
    expect(
      within(confirm).getByRole('button', {
        name: new RegExp(`^Why is ${target.ringName}'s severance`, 'u'),
      }),
    ).toBeInTheDocument();
    const preview = await rendered.transport.host.query('contracts.releasePreview', {
      employmentId: target.employmentId,
    });
    if (!preview.result.ok || preview.result.data.kind !== 'ok') throw new Error('No preview');
    const expected = preview.result.data.severance.value;

    await rendered.user.click(within(confirm).getByRole('button', { name: 'Release' }));
    await waitFor(() => {
      expect(rendered.issued).toContainEqual({
        name: 'contracts.release',
        args: { employmentId: target.employmentId, expectedSeverance: expected },
      });
    });
    expect(
      await screen.findByText(
        new RegExp(`^Released ${target.ringName}\\. Severance`, 'u'),
        undefined,
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    // The sheet closes after the release; the page behind it is readable again once it has gone.
    expect(
      await screen.findByRole('link', { name: 'See it in the ledger' }, { timeout: LOAD_MS }),
    ).toHaveAttribute('href', routes.game.finances({ tab: 'ledger' }));
  });

  it('keeps the confirm open when the severance changed', async () => {
    const rendered = renderContracts(CONTRACTS, {
      cannedCommands: {
        'contracts.release': () => ({
          ok: false,
          reasons: [{ code: 'severanceChanged', message: 'The severance is now different.' }],
        }),
      },
    });
    const { confirm } = await openReleaseConfirm(rendered);
    await rendered.user.click(within(confirm).getByRole('button', { name: 'Release' }));
    expect(await within(confirm).findByText(SEVERANCE_CHANGED_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBe(confirm);
  });

  it('answers a request to leave: Refuse at once, Grant after a confirm', async () => {
    const rendered = renderContracts(
      `${CONTRACTS}?tab=active&wantsToLeave=1&employment=${FIXTURE_EMPLOYMENT}`,
      {
        canned: {
          'contracts.list': () => [aContractRow({ request: anOwnDetail().request })],
          'contracts.detail': () => anOwnDetail(),
          'contracts.answerPreview': () => anAnswerPreview(),
        },
        cannedCommands: {
          'contracts.answerReleaseRequest': (args) =>
            Reflect.get(Object(args), 'answer') === 'grant'
              ? {
                  ok: true,
                  data: {
                    answer: 'grant',
                    severance: 2_160_100,
                    cashAfter: 0,
                    ledgerTraceRef: null,
                  },
                }
              : {
                  ok: true,
                  data: {
                    answer: 'refuse',
                    walkoutChance: {
                      value: 0.025,
                      trace: { kind: 'input', label: 'Walk-out chance', value: 0.025 },
                    },
                  },
                },
        },
      },
    );
    const sheet = await screen.findByRole('dialog', { name: 'Mara Quill' }, { timeout: LOAD_MS });
    const request = await within(sheet).findByRole(
      'region',
      { name: 'Release request' },
      { timeout: LOAD_MS },
    );
    expect(within(request).getByText(/^Mara Quill wants to leave \(asked /u)).toBeInTheDocument();
    expect(
      await within(request).findByRole('button', {
        name: /^Why is Severance if you let Mara Quill go/u,
      }),
    ).toBeInTheDocument();
    expect(
      within(request).getByRole('button', { name: /^Why is Mara Quill's daily walk-out chance/u }),
    ).toBeInTheDocument();

    await rendered.user.click(within(request).getByRole('button', { name: 'Refuse' }));
    await waitFor(() => {
      expect(rendered.issued).toContainEqual({
        name: 'contracts.answerReleaseRequest',
        args: { employmentId: FIXTURE_EMPLOYMENT, answer: 'refuse' },
      });
    });

    await rendered.user.click(within(request).getByRole('button', { name: 'Grant' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Let Mara Quill go?' });
    await rendered.user.click(within(confirm).getByRole('button', { name: 'Grant' }));
    await waitFor(() => {
      expect(rendered.issued).toContainEqual({
        name: 'contracts.answerReleaseRequest',
        args: { employmentId: FIXTURE_EMPLOYMENT, answer: 'grant' },
      });
    });
    expect(
      await screen.findByText(/^Let Mara Quill go\. Severance/u, undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('marks expiry notices seen one at a time or all at once', async () => {
    const rendered = renderContracts(`${CONTRACTS}?tab=expiring`, {
      canned: {
        'contracts.list': () => [aContractRow({ notice: 'unseen', daysLeft: 20 })],
        'contracts.counts': () => ({ unseenExpiring: 2, wantsToLeave: 0 }),
      },
      cannedCommands: {
        'contracts.acknowledgeExpiries': () => ({ ok: true, data: null }),
      },
    });
    const banner = await screen.findByRole(
      'region',
      { name: 'New expiry notices' },
      { timeout: LOAD_MS },
    );
    expect(
      within(banner).getByText(
        '2 contracts are close to their end date. Skips stop until you’ve seen them.',
      ),
    ).toBeInTheDocument();
    const table = await findTable('Expiring contracts');
    const row = await within(table).findByRole(
      'row',
      { name: /Mara Quill/u },
      { timeout: LOAD_MS },
    );
    expect(within(row).getByText('New')).toBeInTheDocument();
    await rendered.user.click(within(row).getByRole('button', { name: 'Got it' }));
    await rendered.user.click(within(banner).getByRole('button', { name: 'Mark all seen' }));
    await waitFor(() => {
      expect(rendered.issued).toEqual([
        { name: 'contracts.acknowledgeExpiries', args: { employmentIds: [FIXTURE_EMPLOYMENT] } },
        { name: 'contracts.acknowledgeExpiries', args: { employmentIds: 'all' } },
      ]);
    });
    // The automatic renewal stopgap is off by default since ECO5-05, and Renew is registered
    // (ECO5-06): the tab points the player at it.
    expect(
      screen.getByText(/^Contracts end on their date unless you renew them\./u),
    ).not.toHaveTextContent('Renews automatically');
  });

  it('sets two overrides for Restless and clears both for Normal', async () => {
    const rendered = renderContracts();
    await findTable('Active contracts');
    await rendered.user.click(screen.getByRole('button', { name: 'Rules' }));
    const sheet = await screen.findByRole('dialog', { name: 'Contract rules' });
    const patience = within(sheet).getByRole('group', { name: 'Worker patience' });
    await waitFor(() => {
      expect(within(patience).getByRole('radio', { name: /^Normal/u })).toBeChecked();
    });
    await rendered.user.click(within(patience).getByRole('radio', { name: /^Restless/u }));
    await waitFor(() => {
      expect(within(patience).getByRole('radio', { name: /^Restless/u })).toBeChecked();
    });
    await rendered.user.click(within(patience).getByRole('radio', { name: /^Normal/u }));
    await waitFor(() => {
      expect(within(patience).getByRole('radio', { name: /^Normal/u })).toBeChecked();
    });
    expect(rendered.issued).toEqual([
      { name: 'tunables.setOverride', args: { key: 'contracts.quit.threshold', value: -15 } },
      { name: 'tunables.setOverride', args: { key: 'contracts.quit.days', value: 3 } },
      { name: 'tunables.clearOverride', args: { key: 'contracts.quit.threshold' } },
      { name: 'tunables.clearOverride', args: { key: 'contracts.quit.days' } },
    ]);
  });
});
