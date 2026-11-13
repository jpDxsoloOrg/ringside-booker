import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACE_NODE_KINDS } from '@ringside/engine';
import type { EngineState, TraceNode, TraceNodeKind } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import {
  attendanceTrace,
  matchRatingTrace,
  OLDER_ATTENDANCE_REF,
  RECENT_ATTENDANCE_REF,
  recentAttendanceEntry,
  summarisedAttendance,
} from '@/screens/dev-gallery/fixtures/traces';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { Explained } from './Explained';
import { TracePanel, TraceSummaryView } from './TracePanel';
import { useTracePanelStore } from './tracePanelStore';
import { traceToText } from './traceToText';
import { TEXT_SEPARATOR } from './wording';
import { WhyButton } from './WhyButton';

/** One node of every kind the engine defines, under a formula root. */
const everyKindTrace: TraceNode = {
  kind: 'formula',
  label: 'Every kind',
  value: 42,
  unit: 'points',
  children: [
    { kind: 'input', label: 'Starting skill', value: 50, unit: 'points' },
    {
      kind: 'formula',
      label: 'Nested step',
      value: 3,
      children: [{ kind: 'input', label: 'Inner input', value: 3 }],
    },
    { kind: 'constant', label: 'Week length', value: 7, reason: 'a week has 7 days' },
    {
      kind: 'tunable',
      label: 'Rest recovery per day',
      key: 'condition.restPerDay',
      value: 0,
      defaultValue: 12,
      overridden: true,
    },
    {
      kind: 'add',
      label: 'Main event bonus',
      value: 56,
      unit: 'points',
      operand: 6,
      before: 50,
      after: 56,
    },
    {
      kind: 'subtract',
      label: 'Tired legs',
      value: 52,
      unit: 'points',
      operand: 4,
      before: 56,
      after: 52,
    },
    {
      kind: 'multiply',
      label: 'Hot crowd',
      value: 59.8,
      unit: 'points',
      operand: 1.15,
      before: 52,
      after: 59.8,
      reason: 'Sold-out arena',
    },
    {
      kind: 'divide',
      label: 'Split between partners',
      value: 29.9,
      unit: 'points',
      operand: 2,
      before: 59.8,
      after: 29.9,
    },
    {
      kind: 'power',
      label: 'Steady curve',
      value: 29.9,
      unit: 'points',
      operand: 1,
      before: 29.9,
      after: 29.9,
    },
    {
      kind: 'max',
      label: 'Lowest it can go',
      value: 112,
      unit: 'points',
      limit: 112,
      before: 29.9,
      after: 112,
      applied: true,
    },
    {
      kind: 'clamp',
      label: 'Kept between 0 and 100',
      value: 100,
      unit: 'points',
      min: 0,
      max: 100,
      before: 112,
      after: 100,
      applied: true,
    },
    {
      kind: 'min',
      label: 'Production ceiling',
      value: 45,
      unit: 'points',
      limit: 45,
      before: 100,
      after: 45,
      applied: true,
    },
    {
      kind: 'round',
      label: 'Rounded down',
      value: 37,
      unit: 'points',
      mode: 'floor',
      before: 37.6,
      after: 37,
    },
    {
      kind: 'roll',
      label: 'Crowd swing',
      value: 37,
      roll: {
        stream: 'crowd.swing',
        kind: 'int',
        label: 'Crowd swing',
        odds: 1 / 101,
        min: 0,
        max: 100,
        result: 37,
      },
    },
    {
      kind: 'branch',
      label: 'Main event slot',
      value: true,
      condition: 'Main event slot',
      taken: true,
    },
    {
      kind: 'decision',
      label: 'Title decision',
      value: 'retain',
      chosen: 'retain',
      reason: 'Keeping the title scored higher',
      considered: [
        { option: 'change', score: 48 },
        { option: 'retain', score: 62 },
      ],
    },
    { kind: 'note', label: 'Title match', value: null },
  ],
};

/** The text of every row, matched loosely so a test reads like the panel. */
const EVERY_KIND_ROWS: Readonly<Record<TraceNodeKind, string>> = {
  formula: 'Nested step: 3',
  input: 'Starting skill: 50',
  constant: 'Week length: 7',
  tunable: 'Rest recovery per day: 0',
  add: '+6 Main event bonus',
  subtract: '−4 Tired legs',
  multiply: '×1.15 Hot crowd',
  divide: '÷2 Split between partners',
  power: 'raised to the power 1 (Steady curve)',
  max: 'Raised 29.9 → 112 (minimum)',
  clamp: 'Capped 112 → 100 (maximum)',
  min: 'Capped 100 → 45 (maximum)',
  round: 'Rounded down 37.6 → 37',
  roll: 'Crowd swing: rolled 37 on 0–100 (both ends possible)',
  branch: 'Because Main event slot',
  decision: 'Title decision: Retain',
  note: 'Title match',
};

function kindsIn(node: TraceNode, found = new Set<TraceNodeKind>()): Set<TraceNodeKind> {
  found.add(node.kind);
  for (const child of node.children ?? []) kindsIn(child, found);
  return found;
}

function renderPanel(trace: TraceNode, onClose = vi.fn()) {
  return render(<TracePanel title="Breakdown" source={{ trace }} open onClose={onClose} />);
}

function treeItemByText(text: string): HTMLElement {
  const item = screen.getByText(text, { exact: false }).closest('[role="treeitem"]');
  if (!(item instanceof HTMLElement)) throw new Error(`No tree item holds "${text}"`);
  return item;
}

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
  vi.restoreAllMocks();
});

describe('TracePanel rows', () => {
  it('the fixture holds one node of every kind the engine defines', () => {
    expect([...kindsIn(everyKindTrace)].sort()).toEqual([...TRACE_NODE_KINDS].sort());
  });

  it('renders a row for every kind', () => {
    renderPanel(everyKindTrace);
    const dialog = screen.getByRole('dialog', { name: 'Breakdown' });
    // The root is the headline; every other node is a row.
    expect(within(dialog).getAllByRole('treeitem')).toHaveLength(18);
    for (const text of Object.values(EVERY_KIND_ROWS)) {
      expect(within(dialog).getByText(text, { exact: false })).toBeInTheDocument();
    }
  });

  it('pins the final value and its label at the top', () => {
    renderPanel(attendanceTrace);
    expect(screen.getByText('Attendance', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('9,000').length).toBeGreaterThan(0);
  });

  it('shows the before and after values of an applied clamp', () => {
    renderPanel(attendanceTrace);
    expect(screen.getByText('Capped 9,518 → 9,000 (maximum)')).toBeInTheDocument();
  });

  it('hides checks that changed nothing until the toggle shows them', async () => {
    const user = userEvent.setup();
    renderPanel(matchRatingTrace);
    expect(screen.queryByText('Checked 71 against 0–100: already in range')).toBeNull();
    expect(screen.queryByText('Did not apply: Title match')).toBeNull();

    const toggle = screen.getByRole('button', { name: "Show checks that didn't apply (3)" });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Checked 71 against 0–100: already in range')).toBeInTheDocument();
    expect(screen.getByText('Did not apply: Title match')).toBeInTheDocument();
  });

  it('says a roll includes both ends of its range and names its stream', () => {
    renderPanel(attendanceTrace);
    expect(
      screen.getByText('Walk-up crowd: rolled 212 on −500 to 500 (both ends possible)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Random stream attendance.walkUp')).toBeInTheDocument();
  });

  it('shows a custom setting badge with the default for an overridden tunable', () => {
    renderPanel(attendanceTrace);
    const row = treeItemByText('Fans per hype point: 15');
    expect(within(row).getByText('Custom setting')).toBeInTheDocument();
    expect(within(row).getByText('default 12')).toBeInTheDocument();
  });

  it('names the setting behind a tunable row by its key', () => {
    renderPanel(attendanceTrace);
    const overridden = treeItemByText('Fans per hype point: 15');
    expect(within(overridden).getByText('attendance.hypeFans')).toBeInTheDocument();
    const untouched = treeItemByText('Largest walk-up swing: 500');
    expect(within(untouched).getByText('Game setting')).toBeInTheDocument();
    expect(within(untouched).getByText('attendance.walkUpSwing')).toBeInTheDocument();
  });

  it("puts a decision root's choice in words at the top", () => {
    renderPanel({
      kind: 'decision',
      label: 'Expected push',
      value: 'mainEvent',
      chosen: 'mainEvent',
      reason: 'A standing of 0.89 reaches the main event mark of 0.85',
      considered: [
        { option: 'mainEvent', score: 0.89 },
        { option: 'upperCard', score: 0.89 },
      ],
    });
    expect(screen.getAllByText('Main event').length).toBeGreaterThan(0);
    expect(screen.queryByText(/mainEvent|upperCard/)).not.toBeInTheDocument();
    expect(screen.getByText('Also considered: Upper card, score 0.89')).toBeInTheDocument();
  });

  it('lists the chosen option first, then the others with their scores', () => {
    renderPanel(everyKindTrace);
    const options = within(treeItemByText('Title decision: Retain')).getAllByRole('listitem');
    expect(options.map((option) => option.textContent)).toEqual([
      'Chosen: Retain, score 62',
      'Also considered: Change, score 48',
    ]);
  });

  it('shows every part of the copy-as-text lines on screen', async () => {
    const user = userEvent.setup();
    renderPanel(matchRatingTrace);
    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    await user.click(screen.getByRole('button', { name: "Show checks that didn't apply (3)" }));
    const shown = screen.getByRole('tree').textContent;
    for (const line of traceToText(matchRatingTrace).split('\n').slice(1)) {
      for (const part of line.trim().split(TEXT_SEPARATOR)) {
        expect(shown).toContain(part);
      }
    }
  });
});

describe('TraceTree', () => {
  it('starts open to depth 2 and opens or closes everything on request', async () => {
    const user = userEvent.setup();
    renderPanel(matchRatingTrace);
    expect(treeItemByText('Work rate: 68')).toHaveAttribute('aria-expanded', 'true');
    // A group at depth 2 starts closed, so its steps are not drawn.
    expect(treeItemByText('Crowd reaction: 12')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Performance: 68')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByText('Performance: 68')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(treeItemByText('Work rate: 68')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Average ring skill: 70')).toBeNull();
  });

  it('moves with the arrow keys: Up and Down, Right opens or steps in, Left closes or steps out', async () => {
    const user = userEvent.setup();
    renderPanel(matchRatingTrace);
    const workRate = treeItemByText('Work rate: 68');
    workRate.focus();

    await user.keyboard('{ArrowDown}');
    const skill = treeItemByText('Average ring skill: 70');
    expect(skill).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(workRate).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(workRate).toHaveAttribute('aria-expanded', 'false');
    expect(workRate).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(workRate).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{ArrowRight}');
    expect(treeItemByText('Average ring skill: 70')).toHaveFocus();

    await user.keyboard('{ArrowLeft}');
    expect(workRate).toHaveFocus();
    expect(workRate).toHaveAttribute('tabindex', '0');
  });

  it('opens a closed group with a click on its row', async () => {
    const user = userEvent.setup();
    renderPanel(matchRatingTrace);
    const crowd = treeItemByText('Crowd reaction: 12');
    await user.click(within(crowd).getByText('Crowd reaction: 12'));
    expect(crowd).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Performance: 68')).toBeInTheDocument();
  });
});

describe('copy as text', () => {
  it('copies the breakdown with the Clipboard API', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderPanel(attendanceTrace);
    await user.click(screen.getByRole('button', { name: 'Copy as text' }));
    expect(writeText).toHaveBeenCalledWith(traceToText(attendanceTrace));
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
  });

  it('falls back to selected text when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Not allowed'));
    renderPanel(attendanceTrace);
    await user.click(screen.getByRole('button', { name: 'Copy as text' }));
    const fallback = screen.getByRole('textbox', { name: 'Breakdown as text' });
    expect(fallback).toHaveValue(traceToText(attendanceTrace));
    expect(fallback).toHaveFocus();
  });
});

describe('Explained and WhyButton', () => {
  it('renders only the number when there is no trace', () => {
    render(<Explained value={1250} label="Merchandise sold" unit="count" />);
    expect(screen.getByText('1,250')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names the button after the number and opens the panel, returning focus on close', async () => {
    const user = userEvent.setup();
    render(<Explained value={9000} label="Attendance" unit="people" trace={attendanceTrace} />);
    expect(screen.getByText('9,000 people')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Why is Attendance 9,000 people?' });

    await user.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Attendance' });
    expect(within(dialog).getByRole('tree')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(button).toHaveFocus();
  });

  it('keeps one panel open at a time', async () => {
    const user = userEvent.setup();
    render(
      <>
        <WhyButton label="Attendance" value={9000} source={{ trace: attendanceTrace }} />
        <WhyButton label="Match rating" value={71} source={{ trace: matchRatingTrace }} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Attendance 9,000?' }));
    expect(screen.getByRole('dialog', { name: 'Attendance' })).toBeInTheDocument();
    const firstPanelId = useTracePanelStore.getState().openPanelId;

    // A second panel asked to open (from a link inside the first, say) replaces the first.
    act(() => {
      useTracePanelStore.getState().openPanel('another-panel');
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Attendance' })).toBeNull();
    });
    expect(useTracePanelStore.getState().openPanelId).not.toBe(firstPanelId);
  });

  it('takes a name of its own when it explains a choice rather than a number', () => {
    render(
      <WhyButton
        label="slot 3"
        value="Ace vs Rookie"
        buttonLabel="Why this segment? Slot 3, Midcard"
        source={{ trace: matchRatingTrace }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Why this segment? Slot 3, Midcard' }),
    ).toBeInTheDocument();
  });
});

describe('traces fetched by reference', () => {
  /**
   * An in-process engine holding the gallery's stored traces. With `holdAnswers`, queries wait
   * until the returned `release` is called, so the loading state can be seen.
   */
  function engineWrapper({ holdAnswers = false } = {}) {
    const state: EngineState = {
      ...fakeEngineState(),
      traces: {
        version: 1,
        seq: 2,
        full: [recentAttendanceEntry],
        summaries: [summarisedAttendance],
      },
    };
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    transport.host.installEngine(state);
    let release = (): void => undefined;
    const answersReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (holdAnswers) {
      const { host } = transport;
      const runQuery = host.query.bind(host);
      host.query = async (name, args) => {
        await answersReleased;
        return runQuery(name, args);
      };
    }
    function EngineWrapper({ children }: { children: ReactNode }) {
      return <EngineProvider createTransport={() => transport}>{children}</EngineProvider>;
    }
    return { Wrapper: EngineWrapper, release };
  }

  it('shows a loading state, then the stored trace', async () => {
    const user = userEvent.setup();
    const { Wrapper, release } = engineWrapper({ holdAnswers: true });
    render(
      <Wrapper>
        <Explained value={9000} label="Recent attendance" traceRef={RECENT_ATTENDANCE_REF} />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Recent attendance 9,000?' }));
    const dialog = screen.getByRole('dialog', { name: 'Recent attendance' });
    expect(within(dialog).getByText('Loading the breakdown')).toBeInTheDocument();

    release();
    expect(await within(dialog).findByRole('tree')).toBeInTheDocument();
    expect(within(dialog).getByText('Capped 9,518 → 9,000 (maximum)')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy as text' })).toBeInTheDocument();
  });

  it('says plainly when an older result only has its summary', async () => {
    const user = userEvent.setup();
    const { Wrapper } = engineWrapper();
    render(
      <Wrapper>
        <Explained value={6400} label="Older attendance" traceRef={OLDER_ATTENDANCE_REF} />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Older attendance 6,400?' }));
    const dialog = screen.getByRole('dialog', { name: 'Older attendance' });

    expect(
      await within(dialog).findByText('Full breakdown is only kept for recent results'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('6,400')).toBeInTheDocument();
    expect(within(dialog).getByText('−2,100 Promotion popularity')).toBeInTheDocument();
    expect(within(dialog).getByText('Recorded Feb 8, 2031')).toBeInTheDocument();
    expect(within(dialog).queryByRole('tree')).toBeNull();
  });

  it('says so when nothing is stored for the reference', async () => {
    const user = userEvent.setup();
    const { Wrapper } = engineWrapper();
    render(
      <Wrapper>
        <Explained
          value={1}
          label="Unknown"
          traceRef={{ kind: 'show.attendance', id: 'evi_missing' }}
        />
      </Wrapper>,
    );
    await user.click(screen.getByRole('button', { name: 'Why is Unknown 1?' }));
    expect(await screen.findByText('No breakdown is kept for this result.')).toBeInTheDocument();
  });
});

describe('a result kept only as a summary', () => {
  it("says only a summary is kept for another promotion's result", () => {
    render(<TraceSummaryView summary={{ ...summarisedAttendance, summaryOnly: true }} />);
    expect(
      screen.getByText("Only a summary is kept for other promotions' results"),
    ).toBeInTheDocument();
    expect(screen.queryByText('Full breakdown is only kept for recent results')).toBeNull();
    expect(screen.getByText('−2,100 Promotion popularity')).toBeInTheDocument();
  });
});
