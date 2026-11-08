import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import {
  ACTION_ICON_NAMES,
  ICON_GLYPHS,
  ICON_GROUPS,
  ICON_NAMES,
  NAV_ICON_NAMES,
  STATE_ICON_NAMES,
  isIconName,
} from './icons';

describe('Icon', () => {
  it.each(ICON_NAMES)('resolves %s to a Lucide glyph that draws', (name) => {
    expect(ICON_GLYPHS[name]).toBeDefined();

    const { container } = render(<Icon name={name} decorative />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('data-icon', name);
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveClass('lucide');
    expect(svg?.children.length).toBeGreaterThan(0);
  });

  it('hides a decorative icon from assistive technology', () => {
    const { container } = render(<Icon name="star" decorative />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('names a meaningful icon with its label', () => {
    render(<Icon name="injured" label="Injured" />);

    const image = screen.getByRole('img', { name: 'Injured' });
    expect(image).not.toHaveAttribute('aria-hidden');
    expect(image).toHaveAttribute('data-icon', 'injured');
  });

  it('applies the size class and any extra class', () => {
    const { container } = render(<Icon name="add" size="lg" className="extra" decorative />);

    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toMatch(/size-lg/);
    expect(svg).toHaveClass('extra');
  });

  it('requires a choice between decorative and labelled at compile time', () => {
    // @ts-expect-error An icon must be marked decorative or given a label.
    const unmarked = <Icon name="warning" />;
    // @ts-expect-error A labelled icon is not also decorative.
    const both = <Icon name="warning" label="Warning" decorative />;
    expect(unmarked).toBeDefined();
    expect(both).toBeDefined();
  });

  it('covers the navigation, states and actions the screens need', () => {
    expect(NAV_ICON_NAMES).toEqual([
      'office',
      'roster',
      'booking',
      'calendar',
      'titles',
      'storylines',
      'contracts',
      'finance',
      'inbox',
      'settings',
    ]);
    expect(STATE_ICON_NAMES).toEqual(['up', 'down', 'flat', 'injured', 'warning', 'check', 'live']);
    expect(ACTION_ICON_NAMES).toEqual([
      'play',
      'pause',
      'next-day',
      'add',
      'decrease',
      'reset',
      'drag-handle',
      'info',
      'why',
    ]);
  });

  it('has every name exactly once across the gallery groups', () => {
    const grouped = ICON_GROUPS.flatMap((group) => group.names);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    expect(grouped).toEqual([...ICON_NAMES]);
  });

  it('maps no names beyond the declared ones', () => {
    expect(Object.keys(ICON_GLYPHS).sort()).toEqual([...ICON_NAMES].sort());
  });

  it('recognises icon names', () => {
    expect(isIconName('trash')).toBe(true);
    expect(isIconName('next-day')).toBe(true);
    expect(isIconName('rocket')).toBe(false);
    expect(isIconName(3)).toBe(false);
  });
});
