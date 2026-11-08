import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '@/components/Icon';
import { galleryEntry } from './entries/icon.gallery';

describe('icon gallery entry', () => {
  it('lists every mapped icon once, each drawn with its name beside it', () => {
    const { container } = render(<>{galleryEntry.render()}</>);

    const tiles = [...container.querySelectorAll<HTMLElement>('[data-icon-name]')];
    expect(tiles.map((tile) => tile.dataset['iconName'])).toEqual([...ICON_NAMES]);

    for (const tile of tiles) {
      const name = tile.dataset['iconName'] ?? '';
      expect(tile.querySelector(`svg[data-icon="${name}"]`)).not.toBeNull();
      expect(within(tile).getByText(name)).toBeInTheDocument();
    }
  });
});
