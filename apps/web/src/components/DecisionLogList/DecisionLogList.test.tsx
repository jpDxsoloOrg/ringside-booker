import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  galleryDecisionLog,
  galleryEmptyDecisionLog,
  galleryReviewTrace,
} from '@/screens/dev-gallery/fixtures/rivalDesk';
import { DecisionLogList, hiddenPlansText } from './DecisionLogList';

describe('DecisionLogList', () => {
  it('lists the decisions newest first, in words, with a Why? while the breakdown is kept', () => {
    render(
      <DecisionLogList
        log={galleryDecisionLog}
        selectedKind={null}
        onKindChange={vi.fn()}
        traceOf={(entry) => (entry.traceRef === null ? null : galleryReviewTrace)}
      />,
    );

    const rows = within(screen.getByRole('list', { name: /Decisions/ })).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(
      'Weekly roster review: 2 needs, most pressing: Thin at main event: 1 of 2',
    );
    expect(rows[2]).toHaveTextContent('Weekly roster review: no pressing needs');
    expect(within(rows[0]!).getByRole('button', { name: /^Why is/ })).toBeVisible();
    expect(within(rows[2]!).queryByRole('button')).toBeNull();
    expect(screen.getByText('2 plans hidden until they air')).toBeInTheDocument();
  });

  it('filters by the chips the log offers', async () => {
    const onKindChange = vi.fn();
    render(
      <DecisionLogList
        log={galleryDecisionLog}
        selectedKind={null}
        onKindChange={onKindChange}
        traceOf={() => galleryReviewTrace}
      />,
    );

    const chips = within(screen.getByRole('group', { name: /kind/ })).getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual(['All', 'Roster review']);
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true');

    await userEvent.setup({ delay: null }).click(chips[1]!);
    expect(onKindChange).toHaveBeenCalledWith('rosterReview');
  });

  it('offers Load older only while there is an older page', async () => {
    const onLoadOlder = vi.fn();
    const { rerender } = render(
      <DecisionLogList
        log={galleryDecisionLog}
        selectedKind={null}
        onKindChange={vi.fn()}
        onLoadOlder={onLoadOlder}
        traceOf={() => galleryReviewTrace}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
    // At the oldest entry the list says how long decisions are kept (POL4-08).
    expect(screen.getByText('Decisions are kept for the last 4 weeks.')).toBeInTheDocument();

    rerender(
      <DecisionLogList
        log={{ ...galleryDecisionLog, nextBefore: galleryDecisionLog.entries[2]!.decisionId }}
        selectedKind={null}
        onKindChange={vi.fn()}
        onLoadOlder={onLoadOlder}
        traceOf={() => galleryReviewTrace}
      />,
    );
    await userEvent
      .setup({ delay: null })
      .click(screen.getByRole('button', { name: 'Load older' }));
    expect(onLoadOlder).toHaveBeenCalledOnce();
    expect(screen.queryByText('Decisions are kept for the last 4 weeks.')).toBeNull();
  });

  it('says so when nothing has been decided, and counts hidden plans in words', () => {
    render(
      <DecisionLogList log={galleryEmptyDecisionLog} selectedKind={null} onKindChange={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'No decisions yet' })).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
    expect(hiddenPlansText(1)).toBe('1 plan hidden until it airs');
  });
});
