import { describe, expect, it, vi } from 'vitest';
import { setMatchMedia } from './matchMedia';

const PHONE_QUERY = '(width < 48rem)';

describe('matchMedia test stub', () => {
  it('matches nothing by default', () => {
    expect(window.matchMedia(PHONE_QUERY).matches).toBe(false);
  });

  it('returns the configured value for a query', () => {
    setMatchMedia((query) => query === PHONE_QUERY);

    expect(window.matchMedia(PHONE_QUERY).matches).toBe(true);
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
  });

  it('fires change listeners on lists created before the change', () => {
    const phoneQueryList = window.matchMedia(PHONE_QUERY);
    const changeListener = vi.fn<(event: MediaQueryListEvent) => void>();
    const onChange = vi.fn<(event: MediaQueryListEvent) => void>();
    const legacyListener = vi.fn<(event: MediaQueryListEvent) => void>();
    phoneQueryList.addEventListener('change', changeListener);
    phoneQueryList.onchange = onChange;
    // The stub keeps the deprecated API working for libraries that still call it.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    phoneQueryList.addListener(legacyListener);

    setMatchMedia((query) => query === PHONE_QUERY);

    expect(phoneQueryList.matches).toBe(true);
    for (const listener of [changeListener, onChange, legacyListener]) {
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]?.[0]).toMatchObject({ matches: true, media: PHONE_QUERY });
    }
  });

  it('does not fire change listeners when the result stays the same', () => {
    const phoneQueryList = window.matchMedia(PHONE_QUERY);
    const changeListener = vi.fn<(event: Event) => void>();
    phoneQueryList.addEventListener('change', changeListener);

    setMatchMedia((query) => query === '(prefers-color-scheme: dark)');

    expect(changeListener).not.toHaveBeenCalled();
  });

  it('stops calling a listener after it is removed', () => {
    const phoneQueryList = window.matchMedia(PHONE_QUERY);
    const changeListener = vi.fn<(event: Event) => void>();
    phoneQueryList.addEventListener('change', changeListener);
    phoneQueryList.removeEventListener('change', changeListener);

    setMatchMedia(() => true);

    expect(changeListener).not.toHaveBeenCalled();
  });
});
