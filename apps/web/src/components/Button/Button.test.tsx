import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';

describe('Button', () => {
  it('fires onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Book the show</Button>);

    await user.click(screen.getByRole('button', { name: 'Book the show' }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders a plain button by default so it never submits a form', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('keeps an explicit submit type', () => {
    render(<Button type="submit">Send</Button>);

    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
  });

  it('blocks clicks and sets aria-busy while loading', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <Button loading onClick={handleClick}>
        Sign
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Sign' });
    await user.click(button);

    expect(handleClick).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toBeDisabled();
    // The label stays in the DOM (hidden by CSS) so the button keeps its width and its name.
    expect(button).toHaveTextContent('Sign');
  });

  it('has no aria-busy when not loading', () => {
    render(<Button>Idle</Button>);

    expect(screen.getByRole('button', { name: 'Idle' })).not.toHaveAttribute('aria-busy');
  });

  it('applies the variant and size classes', () => {
    render(
      <Button variant="danger" size="sm">
        Release
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Release' });
    expect(button).toHaveClass('variant-danger', 'size-sm');
  });

  it('draws decorative start and end icons', () => {
    const { container } = render(
      <Button iconStart="play" iconEnd="chevron-right">
        Run show
      </Button>,
    );

    expect(container.querySelector('[data-icon="play"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-icon="chevron-right"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Run show' })).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('uses the label as its accessible name and tooltip', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<IconButton icon="close" label="Close panel" onClick={handleClick} />);

    const button = screen.getByRole('button', { name: 'Close panel' });
    expect(button).toHaveAttribute('title', 'Close panel');
    expect(button).toHaveAttribute('type', 'button');
    await user.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('refuses to compile without a label', () => {
    // @ts-expect-error: an icon-only button needs a label, or it has no accessible name.
    const unlabelled = <IconButton icon="close" />;

    expect(unlabelled).toBeDefined();
  });
});
