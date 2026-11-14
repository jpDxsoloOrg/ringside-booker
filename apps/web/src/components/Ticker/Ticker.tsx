import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/styles/useMediaQuery';
import { useReducedMotion } from '@/styles/useReducedMotion';
import { IconButton } from '../Button';
import { classNames } from '../classNames';
import styles from './Ticker.module.css';

export type TickerSpeed = 'slow' | 'normal' | 'fast';
export type TickerTagTone = 'action' | 'data' | 'prestige';
export type TickerAnnounce = 'off' | 'polite';

/** One headline in the crawl. */
export interface TickerItem {
  /** Stable key for the list. */
  readonly id: string;
  /** The headline. Keep it to text: the crawl draws every item twice. */
  readonly content: ReactNode;
  /** A short tag before the headline, such as "Rating surge". */
  readonly tag?: string;
  /** Colour of the tag. `data` by default. */
  readonly tagTone?: TickerTagTone;
}

export interface TickerProps {
  /** The badge at the start of the strip, such as "Breaking". */
  readonly label: string;
  readonly items: readonly TickerItem[];
  /** Names the strip for screen readers. "News ticker" by default. */
  readonly ariaLabel?: string;
  /**
   * Whether screen readers announce new headlines. `off` (the default) keeps a crawl that
   * changes every day from talking over the screen; `polite` waits for a pause.
   */
  readonly announce?: TickerAnnounce;
  /** How fast the crawl moves. `normal` by default. */
  readonly speed?: TickerSpeed;
  /**
   * Sticks the strip to the bottom of the viewport, and above the bottom tab bar on phones. The
   * app shell uses this; inside a screen leave it off.
   */
  readonly docked?: boolean;
  readonly className?: string | undefined;
}

/** Item counts that get their own crawl length. Longer lists crawl at the longest length. */
export const TICKER_MAX_ITEM_CLASS = 12;

/** The duration class for a list: the crawl takes longer the more items it carries. */
export function tickerLengthClass(itemCount: number): string {
  const bucket = Math.min(Math.max(Math.floor(itemCount), 1), TICKER_MAX_ITEM_CLASS);
  return `items-${String(bucket)}`;
}

function TickerItems({
  items,
  currentIndex,
}: {
  readonly items: readonly TickerItem[];
  /** While stepping, the one headline on show; the others keep their room but are hidden. */
  readonly currentIndex?: number;
}) {
  return items.map((item, index) => (
    <li
      key={item.id}
      className={styles['item']}
      {...(currentIndex === undefined ? {} : { 'data-current': String(index === currentIndex) })}
    >
      {item.tag !== undefined && (
        <span className={classNames(styles['tag'], styles[`tag-${item.tagTone ?? 'data'}`])}>
          {item.tag}
        </span>
      )}
      <span className={styles['headline']}>{item.content}</span>
    </li>
  ));
}

/**
 * The news crawl. Headlines move right to left behind a label badge, pause while the pointer is
 * over them or a headline has focus, and can be paused with the button at the end. With reduced motion
 * the crawl becomes a static list that wraps and the pause button goes away. On a phone the strip has
 * no room for a wrapped list, so with reduced motion it shows one headline at a time, wrapped to
 * fit, with buttons to step to the previous and next one (UI-34).
 *
 * The crawl loops by drawing the list twice. The second copy is hidden from screen readers and
 * made inert, so each headline is read and reached once.
 */
export function Ticker({
  label,
  items,
  ariaLabel = 'News ticker',
  announce = 'off',
  speed = 'normal',
  docked = false,
  className,
}: TickerProps) {
  const reducedMotion = useReducedMotion();
  const isMobile = useIsMobile();
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const loopCopyRef = useRef<HTMLUListElement>(null);
  const crawling = !reducedMotion && items.length > 0;
  const stepping = !crawling && isMobile && items.length > 1;
  const currentIndex = items.length === 0 ? 0 : step % items.length;
  const stepBy = (delta: number) => {
    const count = Math.max(items.length, 1);
    setStep((previous) => ((previous % count) + delta + count) % count);
  };

  useEffect(() => {
    const loopCopy = loopCopyRef.current;
    loopCopy?.setAttribute('inert', '');
  }, [crawling]);

  return (
    <section
      aria-label={ariaLabel}
      className={classNames(
        styles['ticker'],
        crawling ? styles['crawling'] : styles['static'],
        stepping && styles['stepping'],
        paused && styles['paused'],
        docked && styles['docked'],
        className,
      )}
      data-motion={crawling ? 'crawl' : 'static'}
      data-stepping={stepping ? 'on' : undefined}
    >
      <span className={styles['badge']}>{label}</span>
      {stepping && (
        <div className={styles['stepControls']}>
          <IconButton
            icon="chevron-left"
            label="Previous headline"
            size="sm"
            onClick={() => {
              stepBy(-1);
            }}
          />
          <IconButton
            icon="chevron-right"
            label="Next headline"
            size="sm"
            onClick={() => {
              stepBy(1);
            }}
          />
        </div>
      )}
      <div className={styles['viewport']} data-part="viewport">
        <div
          className={classNames(
            styles['track'],
            styles[`speed-${speed}`],
            styles[tickerLengthClass(items.length)],
          )}
          data-part="track"
        >
          <ul className={styles['list']} aria-live={stepping ? 'polite' : announce}>
            <TickerItems items={items} {...(stepping ? { currentIndex } : {})} />
          </ul>
          {crawling && (
            <ul
              ref={loopCopyRef}
              className={styles['list']}
              aria-hidden="true"
              data-part="loop-copy"
            >
              <TickerItems items={items} />
            </ul>
          )}
        </div>
      </div>
      {crawling && (
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label="Pause ticker"
          aria-pressed={paused}
          size="sm"
          className={styles['pauseButton']}
          onClick={() => {
            setPaused((wasPaused) => !wasPaused);
          }}
        />
      )}
    </section>
  );
}
