import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY } from '@/styles/useReducedMotion';
import { setMatchMedia } from '@/test/matchMedia';
import { LiveBugButton } from './LiveBugButton';

function dotOf(button: HTMLElement): Element | null {
  return button.querySelector('[data-part="dot"]');
}

describe('LiveBugButton', () => {
  it('is a button named by its label, with a decorative pulsing dot', async () => {
    const onClick = vi.fn();
    render(
      <LiveBugButton onClick={onClick} iconEnd="next-day">
        Next day
      </LiveBugButton>,
    );

    const button = screen.getByRole('button', { name: 'Next day' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('bug', 'size-md');
    expect(button.querySelector('[style]')).toBeNull();
    const dot = dotOf(button);
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveAttribute('data-motion', 'pulse');
    expect(dot).toHaveClass('pulse');

    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('can give way in a crowded bar and keeps its label as the name', () => {
    render(
      <>
        <LiveBugButton iconEnd="next-day">Go live</LiveBugButton>
        <LiveBugButton iconEnd="next-day" shrinkable>
          Next day
        </LiveBugButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Go live' })).not.toHaveClass('shrinkable');
    expect(screen.getByRole('button', { name: 'Next day' })).toHaveClass('bug', 'shrinkable');
  });

  it('comes in a large size', () => {
    render(<LiveBugButton size="lg">Go live</LiveBugButton>);
    expect(screen.getByRole('button', { name: 'Go live' })).toHaveClass('size-lg');
  });

  it('holds the dot still under reduced motion and starts pulsing when motion returns', () => {
    setMatchMedia((query) => query === REDUCED_MOTION_QUERY);
    render(<LiveBugButton>Go live</LiveBugButton>);

    const button = screen.getByRole('button', { name: 'Go live' });
    expect(dotOf(button)).toHaveAttribute('data-motion', 'static');
    expect(dotOf(button)).not.toHaveClass('pulse');

    act(() => {
      setMatchMedia(() => false);
    });
    expect(dotOf(button)).toHaveAttribute('data-motion', 'pulse');
  });

  it('is disabled and busy while the action runs, with a still dot', async () => {
    const onClick = vi.fn();
    render(
      <LiveBugButton busy onClick={onClick}>
        Next day
      </LiveBugButton>,
    );

    const button = screen.getByRole('button', { name: 'Next day' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(dotOf(button)).toHaveAttribute('data-motion', 'static');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can drop the dot when nothing is live', () => {
    render(<LiveBugButton live={false}>Continue</LiveBugButton>);
    expect(dotOf(screen.getByRole('button', { name: 'Continue' }))).toBeNull();
  });
});
