import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Cluster } from './Cluster';
import { Stack } from './Stack';
import { VisuallyHidden } from './VisuallyHidden';

describe('Stack', () => {
  it('is a column with a 1rem gap by default', () => {
    const { container } = render(
      <Stack>
        <p>One</p>
        <p>Two</p>
      </Stack>,
    );

    const stack = container.firstElementChild;
    expect(stack).toHaveClass('stack', 'gap-4', 'align-stretch');
    expect(stack).not.toHaveClass('direction-row');
  });

  it('maps direction, gap and element to classes', () => {
    const { container } = render(
      <Stack direction="row" gap={0} as="ul">
        <li>One</li>
      </Stack>,
    );

    const stack = container.firstElementChild;
    expect(stack?.tagName).toBe('UL');
    expect(stack).toHaveClass('direction-row', 'gap-0', 'list');
  });
});

describe('Cluster', () => {
  it('wraps a row with a token gap and justification', () => {
    const { container } = render(
      <Cluster gap={6} justify="between">
        <span>A</span>
        <span>B</span>
      </Cluster>,
    );

    expect(container.firstElementChild).toHaveClass('cluster', 'gap-6', 'justify-between');
  });
});

describe('VisuallyHidden', () => {
  it('keeps its text available to assistive technology', () => {
    render(<VisuallyHidden>3 unread</VisuallyHidden>);

    expect(screen.getByText('3 unread')).toHaveClass('visuallyHidden');
  });
});
