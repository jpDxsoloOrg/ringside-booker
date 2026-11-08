import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { ICON_NAMES, ICON_PATHS, isIconName } from './icons';

describe('Icon', () => {
  it.each(ICON_NAMES)('draws %s from at least one path', (name) => {
    const { container } = render(<Icon name={name} />);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.querySelectorAll('path')).toHaveLength(ICON_PATHS[name].length);
  });

  it('is hidden from assistive technology without a title', () => {
    const { container } = render(<Icon name="star" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).not.toHaveAttribute('role');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('becomes a named image when given a title', () => {
    render(<Icon name="calendar" title="Show day" />);

    const image = screen.getByRole('img', { name: 'Show day' });
    expect(image).not.toHaveAttribute('aria-hidden');
    expect(image.querySelector('title')?.textContent).toBe('Show day');
  });

  it('has a unique path list for every icon', () => {
    const drawings = ICON_NAMES.map((name) => ICON_PATHS[name].join(' '));
    expect(new Set(drawings).size).toBe(ICON_NAMES.length);
  });

  it('recognises icon names', () => {
    expect(isIconName('trash')).toBe(true);
    expect(isIconName('rocket')).toBe(false);
    expect(isIconName(3)).toBe(false);
  });
});
