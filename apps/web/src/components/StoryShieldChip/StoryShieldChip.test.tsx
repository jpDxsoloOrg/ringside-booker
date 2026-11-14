import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoryShieldChip } from './StoryShieldChip';

const TRACE = { kind: 'input', label: 'Story shield', value: 100 } as const;

describe('StoryShieldChip', () => {
  it('says the shield in words for each band, with no Why? without a trace', () => {
    const { rerender } = render(<StoryShieldChip percent={100} band="hot" finale={false} />);
    expect(screen.getByText('Story shield 100%')).toBeInTheDocument();
    rerender(<StoryShieldChip percent={25} band="warm" finale />);
    expect(screen.getByText('Story shield 25%')).toBeInTheDocument();
    expect(screen.getByText('in the finale')).toBeInTheDocument();
    rerender(<StoryShieldChip percent={0} band="none" finale={false} />);
    expect(screen.getByText('No story shield')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('has a Why? when given a trace', () => {
    render(<StoryShieldChip percent={100} band="hot" finale={false} trace={TRACE} />);
    expect(screen.getByRole('button', { name: 'Why story shield 100%?' })).toBeInTheDocument();
  });
});
