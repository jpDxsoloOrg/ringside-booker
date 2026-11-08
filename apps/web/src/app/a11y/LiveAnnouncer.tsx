import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './a11y.module.css';

export type AnnouncePoliteness = 'polite' | 'assertive';

export interface AnnounceOptions {
  /** `polite` (the default) waits for the screen reader to finish; `assertive` interrupts. */
  readonly politeness?: AnnouncePoliteness;
}

export type Announce = (message: string, options?: AnnounceOptions) => void;

/**
 * How long a region stays empty before the new message goes in. Screen readers only speak a
 * change, so emptying the region first makes the same message twice in a row be read twice.
 */
export const ANNOUNCE_DELAY_MS = 100;

const AnnounceContext = createContext<Announce | null>(null);

interface RegionMessages {
  readonly polite: string;
  readonly assertive: string;
}

const EMPTY_MESSAGES: RegionMessages = { polite: '', assertive: '' };

export interface LiveAnnouncerProps {
  readonly children: ReactNode;
}

/**
 * Renders the app's two visually hidden live regions and gives every screen `useAnnounce()` to
 * speak short status messages, such as the result of advancing a day. Mounted once at the root,
 * so the regions exist before anything is announced into them.
 */
export function LiveAnnouncer({ children }: LiveAnnouncerProps) {
  const [messages, setMessages] = useState<RegionMessages>(EMPTY_MESSAGES);
  const timersRef = useRef<Partial<Record<AnnouncePoliteness, number>>>({});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of Object.values(timers)) window.clearTimeout(timer);
    };
  }, []);

  const announce = useCallback<Announce>((message, options = {}) => {
    const politeness = options.politeness ?? 'polite';
    window.clearTimeout(timersRef.current[politeness]);
    setMessages((current) => ({ ...current, [politeness]: '' }));
    timersRef.current[politeness] = window.setTimeout(() => {
      setMessages((current) => ({ ...current, [politeness]: message }));
    }, ANNOUNCE_DELAY_MS);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      <div className={styles['liveRegion']} aria-live="polite" aria-atomic="true" role="status">
        {messages.polite}
      </div>
      <div className={styles['liveRegion']} aria-live="assertive" aria-atomic="true" role="alert">
        {messages.assertive}
      </div>
    </AnnounceContext.Provider>
  );
}

/** The `announce(message, { politeness })` function of the nearest `LiveAnnouncer`. */
export function useAnnounce(): Announce {
  const announce = useContext(AnnounceContext);
  if (announce === null) {
    throw new Error('useAnnounce() needs a <LiveAnnouncer> above it in the tree.');
  }
  return announce;
}
