import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useStickyBarScrollPadding } from './useStickyBarScrollPadding';

function Bar({ sticky }: { readonly sticky: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyBarScrollPadding(ref);
  return <div ref={ref} data-sticky={sticky ? 'yes' : 'no'} />;
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

describe('useStickyBarScrollPadding', () => {
  afterEach(() => {
    document.documentElement.style.scrollPaddingBlockEnd = '';
    added.splice(0).forEach((node) => {
      node.remove();
    });
  });

  it('pads the page bottom by what a sticky bar covers, and restores it on unmount', () => {
    styleBars();
    document.documentElement.style.scrollPaddingBlockEnd = '8px';
    const { unmount } = render(<Bar sticky />);
    expect(document.documentElement.style.scrollPaddingBlockEnd).toBe('72px');
    unmount();
    expect(document.documentElement.style.scrollPaddingBlockEnd).toBe('8px');
  });

  it('leaves the padding alone when the bar is not sticky (desktop)', () => {
    styleBars();
    render(<Bar sticky={false} />);
    expect(document.documentElement.style.scrollPaddingBlockEnd).toBe('');
  });
});
