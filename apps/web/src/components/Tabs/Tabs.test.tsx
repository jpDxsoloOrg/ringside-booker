import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';
import type { TabsActivation } from './Tabs';

const TAB_VALUES = ['roster', 'titles', 'finances', 'schedule'] as const;

function tabLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

interface SampleTabsProps {
  readonly activation?: TabsActivation;
  readonly onChange?: (value: string) => void;
  readonly disabledValue?: string;
}

function SampleTabs({ activation = 'auto', onChange, disabledValue }: SampleTabsProps) {
  return (
    <Tabs defaultValue="roster" activation={activation} {...(onChange ? { onChange } : {})}>
      <TabList label="Promotion">
        {TAB_VALUES.map((value) => (
          <Tab key={value} value={value} disabled={value === disabledValue}>
            {tabLabel(value)}
          </Tab>
        ))}
      </TabList>
      {TAB_VALUES.map((value) => (
        <TabPanel key={value} value={value}>
          <p>{tabLabel(value)} content</p>
        </TabPanel>
      ))}
    </Tabs>
  );
}

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name });
}

describe('Tabs', () => {
  it('wires tabs and panels together with aria-selected and aria-controls', () => {
    render(<SampleTabs />);

    expect(screen.getByRole('tablist', { name: 'Promotion' })).toBeInTheDocument();
    const rosterTab = tab('Roster');
    const titlesTab = tab('Titles');
    expect(rosterTab).toHaveAttribute('aria-selected', 'true');
    expect(titlesTab).toHaveAttribute('aria-selected', 'false');

    const panel = screen.getByRole('tabpanel', { name: 'Roster' });
    expect(rosterTab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', rosterTab.id);
    expect(panel).toHaveTextContent('Roster content');

    // Every tab points at a panel that exists, even while that panel is hidden.
    for (const value of TAB_VALUES) {
      const controlsId = tab(tabLabel(value)).getAttribute('aria-controls') ?? '';
      expect(document.getElementById(controlsId)).toHaveAttribute('role', 'tabpanel');
    }
    expect(screen.queryByText('Titles content')).toBeNull();
  });

  it('keeps only the selected tab in the Tab order', () => {
    render(<SampleTabs />);

    expect(tab('Roster')).toHaveAttribute('tabindex', '0');
    expect(tab('Titles')).toHaveAttribute('tabindex', '-1');
    expect(tab('Finances')).toHaveAttribute('tabindex', '-1');
  });

  it('selects a tab on click', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<SampleTabs onChange={handleChange} />);

    await user.click(tab('Finances'));

    expect(tab('Finances')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Finances')).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Finances content')).toBeVisible();
    expect(handleChange).toHaveBeenCalledWith('finances');
  });

  describe('automatic activation', () => {
    it('moves focus and selects with the arrow keys, wrapping at the ends', async () => {
      const user = userEvent.setup();
      render(<SampleTabs />);

      await user.tab();
      expect(tab('Roster')).toHaveFocus();

      await user.keyboard('{ArrowRight}');
      expect(tab('Titles')).toHaveFocus();
      expect(tab('Titles')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Titles content')).toBeVisible();

      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(tab('Schedule')).toHaveFocus();
      expect(tab('Schedule')).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{ArrowRight}');
      expect(tab('Roster')).toHaveFocus();
      expect(tab('Roster')).toHaveAttribute('aria-selected', 'true');
    });

    it('jumps to the first and last tab with Home and End', async () => {
      const user = userEvent.setup();
      render(<SampleTabs />);

      await user.tab();
      await user.keyboard('{End}');
      expect(tab('Schedule')).toHaveFocus();
      expect(tab('Schedule')).toHaveAttribute('aria-selected', 'true');

      await user.keyboard('{Home}');
      expect(tab('Roster')).toHaveFocus();
      expect(tab('Roster')).toHaveAttribute('aria-selected', 'true');
    });

    it('skips disabled tabs', async () => {
      const user = userEvent.setup();
      render(<SampleTabs disabledValue="titles" />);

      await user.tab();
      await user.keyboard('{ArrowRight}');
      expect(tab('Finances')).toHaveFocus();
    });

    it('leaves the strip with Tab, landing on the selected panel', async () => {
      const user = userEvent.setup();
      render(<SampleTabs />);

      await user.tab();
      await user.keyboard('{ArrowRight}');
      await user.tab();

      expect(screen.getByRole('tabpanel', { name: 'Titles' })).toHaveFocus();
    });
  });

  describe('manual activation', () => {
    it('moves focus with the arrow keys without selecting', async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<SampleTabs activation="manual" onChange={handleChange} />);

      await user.tab();
      await user.keyboard('{ArrowRight}');

      expect(tab('Titles')).toHaveFocus();
      expect(tab('Titles')).toHaveAttribute('aria-selected', 'false');
      expect(tab('Roster')).toHaveAttribute('aria-selected', 'true');
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('selects the focused tab with Enter', async () => {
      const user = userEvent.setup();
      render(<SampleTabs activation="manual" />);

      await user.tab();
      await user.keyboard('{ArrowRight}{Enter}');

      expect(tab('Titles')).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Titles content')).toBeVisible();
    });

    it('selects the focused tab with Space', async () => {
      const user = userEvent.setup();
      render(<SampleTabs activation="manual" />);

      await user.tab();
      await user.keyboard('{End}[Space]');

      expect(tab('Schedule')).toHaveAttribute('aria-selected', 'true');
    });
  });

  it('follows the value prop when controlled', async () => {
    const user = userEvent.setup();

    function ControlledTabs() {
      const [selected, setSelected] = useState('b');
      return (
        <>
          <p>Selected: {selected}</p>
          <Tabs value={selected} onChange={setSelected}>
            <TabList label="Letters">
              <Tab value="a">A</Tab>
              <Tab value="b">B</Tab>
            </TabList>
            <TabPanel value="a">Panel A</TabPanel>
            <TabPanel value="b">Panel B</TabPanel>
          </Tabs>
        </>
      );
    }

    render(<ControlledTabs />);
    expect(tab('B')).toHaveAttribute('aria-selected', 'true');

    await user.click(tab('A'));
    expect(screen.getByText('Selected: a')).toBeInTheDocument();
    expect(tab('A')).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores the user when a controlled parent keeps its value', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Tabs value="a" onChange={handleChange}>
        <TabList label="Letters">
          <Tab value="a">A</Tab>
          <Tab value="b">B</Tab>
        </TabList>
        <TabPanel value="a">Panel A</TabPanel>
        <TabPanel value="b">Panel B</TabPanel>
      </Tabs>,
    );

    await user.click(tab('B'));
    expect(handleChange).toHaveBeenCalledWith('b');
    expect(tab('A')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps hidden panel content mounted when asked', () => {
    render(
      <Tabs defaultValue="a">
        <TabList label="Letters">
          <Tab value="a">A</Tab>
          <Tab value="b">B</Tab>
        </TabList>
        <TabPanel value="a">Panel A</TabPanel>
        <TabPanel value="b" keepMounted>
          Panel B
        </TabPanel>
      </Tabs>,
    );

    expect(screen.getByText('Panel B')).not.toBeVisible();
  });

  it('builds valid, distinct ids from values with spaces and symbols', () => {
    render(
      <Tabs defaultValue="Main event">
        <TabList label="Card">
          <Tab value="Main event">Main event</Tab>
          <Tab value="Main_event">Underscore</Tab>
        </TabList>
        <TabPanel value="Main event">Main</TabPanel>
        <TabPanel value="Main_event">Other</TabPanel>
      </Tabs>,
    );

    const firstId = tab('Main event').id;
    const secondId = tab('Underscore').id;
    expect(firstId).not.toMatch(/\s/);
    expect(firstId).not.toBe(secondId);
  });

  it('refuses to render a Tab outside Tabs', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Tab value="lost">Lost</Tab>)).toThrow(
      '<Tab> must be rendered inside <Tabs>.',
    );
    vi.restoreAllMocks();
  });
});
