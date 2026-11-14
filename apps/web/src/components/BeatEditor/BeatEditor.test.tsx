import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseId } from '@ringside/engine';
import type { TraceNode } from '@ringside/engine';
import { BeatEditor } from './BeatEditor';
import type { BeatEditorProps, BeatPickerArgs } from './BeatEditor';
import type { BeatDraft, BeatLimit, BeatOption, PersonChip } from './beatDraft';
import type { BeatScore } from './BeatRow';

function person(index: number, name: string): PersonChip {
  return { id: parseId('person', `per_${String(index).padStart(10, '0')}`), name };
}

const REX = person(1, 'Rex Halden');
const TOBIN = person(2, 'Tobin Vasquell');
const MILA = person(3, 'Mila Stroud');

const OPTIONS: readonly BeatOption[] = [
  {
    key: 'beat.staredown',
    name: 'Staredown',
    description: 'Rivals stand face to face and say nothing.',
    groups: [
      { label: 'Side A', minPeople: 1, maxPeople: 4, optional: false },
      { label: 'Side B', minPeople: 1, maxPeople: 4, optional: false },
    ],
    physical: false,
  },
  {
    key: 'beat.war-of-words',
    name: 'War of words',
    description: 'Two sides trade insults on the microphone.',
    groups: [
      { label: 'Side A', minPeople: 1, maxPeople: 4, optional: false },
      { label: 'Side B', minPeople: 1, maxPeople: 4, optional: false },
    ],
    physical: false,
  },
  {
    key: 'beat.attack',
    name: 'Attack',
    description: 'One side jumps the other.',
    groups: [
      { label: 'Attackers', minPeople: 1, maxPeople: 1, optional: false },
      { label: 'Targets', minPeople: 1, maxPeople: 4, optional: false },
    ],
    physical: true,
  },
  {
    key: 'beat.promo',
    name: 'Promo',
    description: 'One side talks.',
    groups: [{ label: 'Speaker', minPeople: 1, maxPeople: 4, optional: false }],
    physical: false,
  },
];

const THREE_BEATS: readonly BeatDraft[] = [
  { id: 'b1', beatKey: 'beat.staredown', groupOne: [REX], groupTwo: [TOBIN] },
  { id: 'b2', beatKey: 'beat.war-of-words', groupOne: [REX], groupTwo: [TOBIN] },
  { id: 'b3', beatKey: 'beat.attack', groupOne: [TOBIN], groupTwo: [REX] },
];

const STANDARD: BeatLimit = { max: 4, message: 'Standard slot: up to 4 beats' };
const SHORT: BeatLimit = { max: 2, message: 'Short slot: up to 2 beats' };

const SCORE_TRACE: TraceNode = {
  kind: 'formula',
  label: 'Beat: Staredown',
  value: 64,
  children: [{ kind: 'input', label: 'Side A', value: 70 }],
};

function TestPicker({ groupLabel, exclude, onPick, onClose }: BeatPickerArgs) {
  return (
    <div role="dialog" aria-label={`Pick for ${groupLabel}`}>
      {[REX, TOBIN, MILA]
        .filter((candidate) => !exclude.includes(candidate.id))
        .map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            onClick={() => {
              onPick(candidate);
            }}
          >
            {candidate.name}
          </button>
        ))}
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

interface HarnessProps extends Partial<Omit<BeatEditorProps, 'beats' | 'onChange'>> {
  readonly initial: readonly BeatDraft[];
  readonly onChange?: (beats: BeatDraft[]) => void;
}

function Harness({ initial, onChange, ...rest }: HarnessProps) {
  const [beats, setBeats] = useState(initial);
  return (
    <BeatEditor
      beatOptions={OPTIONS}
      limit={STANDARD}
      renderPicker={(args) => <TestPicker {...args} />}
      {...rest}
      beats={beats}
      onChange={(next) => {
        onChange?.(next);
        setBeats(next);
      }}
    />
  );
}

function rows(): HTMLElement[] {
  return within(screen.getByRole('list', { name: 'Beats' }))
    .getAllByRole('listitem')
    .filter((item) => item.hasAttribute('data-sortable-id'));
}

function rowNames(): string[] {
  return rows().map((row) => within(row).getByRole('combobox').textContent);
}

/** jsdom lays nothing out, so each beat row gets a rectangle from its place in the list. */
const ROW_HEIGHT = 120;
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const item = this.closest('[data-sortable-id]');
    const all = [...document.querySelectorAll('[data-sortable-id]')];
    const index = item === null ? 0 : Math.max(all.indexOf(item), 0);
    const top = index * ROW_HEIGHT;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      right: 600,
      bottom: top + ROW_HEIGHT - 10,
      width: 600,
      height: ROW_HEIGHT - 10,
      toJSON: () => ({}),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BeatEditor', () => {
  it('renders the beats in order with their group labels from the catalog', () => {
    render(<Harness initial={THREE_BEATS} />);

    expect(rowNames()).toEqual(['Staredown', 'War of words', 'Attack']);
    const [first, , third] = rows();
    if (first === undefined || third === undefined) throw new Error('missing rows');
    expect(within(first).getByRole('heading', { level: 3, name: 'Beat 1' })).toBeInTheDocument();
    expect(within(first).getByRole('group', { name: 'Side A' })).toHaveTextContent('Rex Halden');
    expect(within(third).getByRole('group', { name: 'Attackers' })).toHaveTextContent(
      'Tobin Vasquell',
    );
    expect(within(third).getByRole('group', { name: 'Targets' })).toBeInTheDocument();
    expect(within(third).getByText('Physical')).toBeInTheDocument();
    expect(within(first).getByText(/face to face/)).toBeInTheDocument();
  });

  it('turns Add beat off at the limit and announces the limit message', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial={THREE_BEATS.slice(0, 1)} limit={SHORT} onChange={onChange} />);

    const addBeat = screen.getByRole('button', { name: 'Add beat' });
    expect(addBeat).not.toHaveAttribute('aria-disabled');
    await user.click(addBeat);
    expect(rowNames()).toEqual(['Staredown', 'Staredown']);

    expect(addBeat).toHaveAttribute('aria-disabled', 'true');
    const status = screen.getByText('Short slot: up to 2 beats');
    expect(status).toHaveAttribute('role', 'status');
    expect(addBeat).toHaveAttribute('aria-describedby', status.id);

    await user.click(addBeat);
    expect(rows()).toHaveLength(2);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('marks beats past the limit and says how many to remove', () => {
    render(<Harness initial={THREE_BEATS} limit={SHORT} />);

    expect(
      screen.getByText('Short slot: up to 2 beats. Remove 1 beat to run.'),
    ).toBeInTheDocument();
    const [first, , third] = rows();
    if (first === undefined || third === undefined) throw new Error('missing rows');
    expect(within(third).getByText('Will not run')).toBeInTheDocument();
    expect(within(first).queryByText('Will not run')).toBeNull();
  });

  it('cannot remove the last beat', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={THREE_BEATS.slice(0, 2)} />);

    await user.click(screen.getByRole('button', { name: 'Remove beat 2, War of words' }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove beat 1, Staredown' })).toBeDisabled();
  });

  it('moves a beat with the keyboard: lift, ArrowUp, drop', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial={THREE_BEATS} onChange={onChange} />);

    const grip = screen.getByRole('button', { name: 'Move beat 2, War of words' });
    act(() => {
      grip.focus();
    });
    await user.keyboard('[Space]');
    await user.keyboard('[ArrowUp]');
    await user.keyboard('[Space]');

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledWith([THREE_BEATS[1], THREE_BEATS[0], THREE_BEATS[2]]);
    expect(
      await screen.findByText('Beat 2, War of words moved to position 1 of 3'),
    ).toBeInTheDocument();
  });

  it('moves a beat with the Move down button, announces it and keeps focus', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial={THREE_BEATS} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Move Staredown up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Attack down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move Staredown down' }));

    expect(onChange.mock.calls[0]?.[0]).toEqual([THREE_BEATS[1], THREE_BEATS[0], THREE_BEATS[2]]);
    expect(rowNames()).toEqual(['War of words', 'Staredown', 'Attack']);
    expect(
      screen.getByText('Beat 1, Staredown moved to position 2 of 3', { ignore: 'script' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Move Staredown down' })).toHaveFocus();
    });
  });

  it('drops people from a group the new beat lacks and says so', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Harness initial={THREE_BEATS.slice(0, 1)} onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: 'Beat 1: which beat' });
    act(() => {
      select.focus();
    });
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Promo' }));

    expect(onChange).toHaveBeenCalledWith([
      { id: 'b1', beatKey: 'beat.promo', groupOne: [REX], groupTwo: [] },
    ]);
    const notice = screen.getByText('Removed Tobin Vasquell: Promo has no second group.');
    expect(notice).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('group', { name: 'Side B' })).toBeNull();
  });

  it('adds a person through the picker, leaving out who is already in the beat', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={THREE_BEATS.slice(0, 1)} />);

    await user.click(screen.getByRole('button', { name: 'Add person to Side A' }));
    const picker = screen.getByRole('dialog', { name: 'Pick for Side A' });
    expect(within(picker).queryByRole('button', { name: 'Rex Halden' })).toBeNull();
    expect(within(picker).queryByRole('button', { name: 'Tobin Vasquell' })).toBeNull();
    await user.click(within(picker).getByRole('button', { name: 'Mila Stroud' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('group', { name: 'Side A' })).toHaveTextContent('Mila Stroud');

    await user.click(screen.getByRole('button', { name: 'Remove Mila Stroud from Side A' }));
    expect(screen.getByRole('group', { name: 'Side A' })).not.toHaveTextContent('Mila Stroud');
  });

  it('holds Add person back when the group is full, saying so', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Harness initial={THREE_BEATS.slice(2)} />);

    const add = screen.getByRole('button', { name: 'Add person to Attackers' });
    expect(add).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Full: up to 1')).toBeInTheDocument();
    await user.click(add);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the Why? panel from a score chip with an inline trace', async () => {
    const user = userEvent.setup({ delay: null });
    const scores: Record<string, BeatScore> = { b1: { value: 63.6, trace: SCORE_TRACE } };
    render(<Harness initial={THREE_BEATS.slice(0, 1)} scores={scores} />);

    await user.click(screen.getByRole('button', { name: 'Why is Staredown score 64?' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Beat: Staredown')).toBeInTheDocument();
  });

  it('is read only when disabled: no grip, no add, remove or move', () => {
    render(<Harness initial={THREE_BEATS} disabled />);

    expect(screen.queryByRole('button', { name: /Move|Remove|Add/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Beat 1: which beat' })).toBeDisabled();
  });

  it('sets no inline style attributes of its own', () => {
    const { container } = render(<Harness initial={THREE_BEATS} limit={SHORT} />);
    // SortableItem writes its offset as custom properties and Radix styles the select's value;
    // nothing else may carry a style attribute.
    const styled = [...container.querySelectorAll('[style]')].filter(
      (element) =>
        !element.hasAttribute('data-sortable-id') && element.closest('[role="combobox"]') === null,
    );
    expect(styled).toEqual([]);
  });
});
