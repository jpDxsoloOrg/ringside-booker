import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Panel } from './Panel';

describe('Panel', () => {
  it('is a section named by an h2 by default', () => {
    render(
      <Panel title="Roster" subtitle="24 workers">
        <p>Body</p>
      </Panel>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Roster' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Roster' })).toBeInTheDocument();
    expect(screen.getByText('24 workers')).toBeInTheDocument();
  });

  it.each([2, 3, 4] as const)('renders its title at heading level %i', (level) => {
    render(
      <Panel title="Finances" headingLevel={level}>
        <p>Body</p>
      </Panel>,
    );

    expect(screen.getByRole('heading', { level, name: 'Finances' })).toBeInTheDocument();
  });

  it('can be a plain div', () => {
    const { container } = render(
      <Panel title="Notes" as="div">
        <p>Body</p>
      </Panel>,
    );

    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('renders actions in the header', () => {
    render(
      <Panel title="Card" actions={<button type="button">Edit</button>}>
        <p>Body</p>
      </Panel>,
    );

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('has no disclosure button unless collapsible', () => {
    render(
      <Panel title="Static">
        <p>Always here</p>
      </Panel>,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Always here')).toBeVisible();
  });

  it('toggles its content and aria-expanded when collapsible', async () => {
    const user = userEvent.setup();
    render(
      <Panel title="Injuries" collapsible>
        <p>Two out this week</p>
      </Panel>,
    );

    const toggle = screen.getByRole('button', { name: 'Injuries' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Two out this week')).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: 'Injuries' })).toContainElement(toggle);

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Two out this week')).not.toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Two out this week')).toBeVisible();
  });

  it('toggles with Enter and Space from the keyboard', async () => {
    const user = userEvent.setup();
    render(
      <Panel title="Contracts" collapsible defaultCollapsed>
        <p>Expiring soon</p>
      </Panel>,
    );

    const toggle = screen.getByRole('button', { name: 'Contracts' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('applies the padding class to the body', () => {
    render(
      <Panel title="Table" padding="none">
        <p>Rows</p>
      </Panel>,
    );

    expect(screen.getByText('Rows').parentElement).toHaveClass('padding-none');
  });
});
