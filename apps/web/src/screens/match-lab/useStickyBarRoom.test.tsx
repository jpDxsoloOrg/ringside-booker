import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { STICKY_BAR_ROOM_PROPERTY, useStickyBarRoom } from './useStickyBarRoom';

function Bar({ sticky }: { readonly sticky: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyBarRoom(ref);
  return (
    <div data-testid="host">
      <div ref={ref} data-sticky={sticky ? 'yes' : 'no'} />
    </div>
  );
}

/** jsdom lays nothing out, so the bar's height is 0 and its offset is what the style says. */
const added: HTMLStyleElement[] = [];

function styleBars(): void {
  const style = document.createElement('style');
  style.textContent =
    "[data-sticky='yes'] { position: sticky; bottom: 72px; } [data-sticky='no'] { position: static; }";
  document.head.append(style);
  added.push(style);
}

describe('useStickyBarRoom', () => {
  afterEach(() => {
    added.splice(0).forEach((node) => {
      node.remove();
    });
  });

  it("gives the bar's parent the room a sticky bar covers, and takes it away on unmount", () => {
    styleBars();
    const { getByTestId, unmount } = render(<Bar sticky />);
    const host = getByTestId('host');
    expect(host.style.getPropertyValue(STICKY_BAR_ROOM_PROPERTY)).toBe('72px');
    unmount();
    expect(host.style.getPropertyValue(STICKY_BAR_ROOM_PROPERTY)).toBe('');
  });

  it('leaves the page scroll padding alone', () => {
    styleBars();
    document.documentElement.style.scrollPaddingBlockEnd = '';
    render(<Bar sticky />);
    expect(document.documentElement.style.scrollPaddingBlockEnd).toBe('');
  });

  it('sets no room when the bar is not sticky (desktop)', () => {
    styleBars();
    const { getByTestId } = render(<Bar sticky={false} />);
    expect(getByTestId('host').style.getPropertyValue(STICKY_BAR_ROOM_PROPERTY)).toBe('');
  });
});
