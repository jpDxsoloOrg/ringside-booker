import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { parseContentKey, withPlannedResult } from '@ringside/engine';
import type { MatchDraft, PlannedResult } from '@ringside/engine';
import {
  AUTO_RESULT_OPTION,
  PlannedResultField,
  RANDOM_RESULT_OPTION,
  RANDOM_WINNERS_RESULT_TEXT,
} from './PlannedResultField';

const PINFALL = parseContentKey('method.pinfall');

const DRAFT: MatchDraft = {
  kind: 'match',
  label: null,
  storylineIds: [],
  crew: { refereeId: null, producerId: null, announcerIds: [] },
  participants: [],
  match: {
    matchTypeKey: parseContentKey('match.singles'),
    stipulationKeys: [],
    titleIds: [],
    finishKey: null,
  },
  outcome: null,
};

function renderField(draft: MatchDraft, randomWinners = false) {
  const onChange = vi.fn<(result: PlannedResult) => void>();
  render(
    <PlannedResultField
      draft={draft}
      sideCount={2}
      sideNames={['Side 1: Kai Moreno', 'Side 2: Rex Hale']}
      methods={[{ key: PINFALL, name: 'Pinfall', changesTitles: true, hidden: false, order: 0 }]}
      disabled={false}
      invalid={false}
      randomWinners={randomWinners}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('PlannedResultField', () => {
  it('lists Auto and Random after the sides and before Draw, each with a visible explanation', () => {
    renderField(DRAFT);
    const values = screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'));
    expect(values).toEqual(['side-0', 'side-1', 'auto', 'random', 'draw', 'noContest']);
    expect(
      screen.getByRole('radio', { name: AUTO_RESULT_OPTION.label }),
    ).toHaveAccessibleDescription(AUTO_RESULT_OPTION.description);
    expect(screen.getByText(AUTO_RESULT_OPTION.description)).toBeVisible();
    expect(screen.getByText(RANDOM_RESULT_OPTION.description)).toBeVisible();
  });

  it('picks Auto and Random, and shows the saved choice', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = renderField(DRAFT);
    await user.click(screen.getByRole('radio', { name: AUTO_RESULT_OPTION.label }));
    expect(onChange).toHaveBeenLastCalledWith('auto');
    await user.click(screen.getByRole('radio', { name: RANDOM_RESULT_OPTION.label }));
    expect(onChange).toHaveBeenLastCalledWith('random');
  });

  it('shows a saved Random as checked, with no method to pick', () => {
    renderField(withPlannedResult(DRAFT, 'random'));
    expect(screen.getByRole('radio', { name: RANDOM_RESULT_OPTION.label })).toBeChecked();
    expect(screen.queryByText('Method')).toBeNull();
  });

  it('offers no Auto or Random in a Random winners game', () => {
    renderField(DRAFT, true);
    expect(screen.getByText(RANDOM_WINNERS_RESULT_TEXT)).toBeVisible();
    expect(screen.queryByText(AUTO_RESULT_OPTION.label)).toBeNull();
  });
});
