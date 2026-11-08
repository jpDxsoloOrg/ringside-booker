import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './Tabs.module.css';

/**
 * `auto` (the default) selects a tab as soon as the arrow keys move focus to it. `manual` only
 * moves focus; Enter or Space selects. Use `manual` when showing a panel is slow.
 */
export type TabsActivation = 'auto' | 'manual';

interface TabsContextValue {
  readonly baseId: string;
  readonly selectedValue: string;
  readonly activation: TabsActivation;
  readonly select: (value: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(componentName: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (context === null) {
    throw new Error(`<${componentName}> must be rendered inside <Tabs>.`);
  }
  return context;
}

/** Turns a tab value into a safe id fragment: letters, digits, `-` and `_` pass; the rest are escaped. */
function idFragment(value: string): string {
  return value.replace(
    /[^A-Za-z0-9_-]/g,
    (character) => `_${(character.codePointAt(0) ?? 0).toString(16)}`,
  );
}

function tabId(baseId: string, value: string): string {
  return `${baseId}-tab-${idFragment(value)}`;
}

function panelId(baseId: string, value: string): string {
  return `${baseId}-panel-${idFragment(value)}`;
}

interface TabsSharedProps {
  /** `auto` by default. See `TabsActivation`. */
  readonly activation?: TabsActivation;
  readonly className?: string;
  /** A `TabList` and one `TabPanel` per tab. */
  readonly children: ReactNode;
}

export interface ControlledTabsProps extends TabsSharedProps {
  /** The selected tab's value. */
  readonly value: string;
  /** Called with the newly selected value. */
  readonly onChange: (value: string) => void;
  readonly defaultValue?: never;
}

export interface UncontrolledTabsProps extends TabsSharedProps {
  /** The tab selected at first. The component keeps track of the selection after that. */
  readonly defaultValue: string;
  /** Called with the newly selected value. */
  readonly onChange?: (value: string) => void;
  readonly value?: never;
}

/** Either controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). */
export type TabsProps = ControlledTabsProps | UncontrolledTabsProps;

/**
 * A set of tabs following the WAI-ARIA tabs pattern: one tab stop for the whole strip (roving
 * tabindex), Left/Right/Home/End to move between tabs, and panels linked to their tabs.
 *
 * ```tsx
 * <Tabs defaultValue="roster">
 *   <TabList label="Promotion">
 *     <Tab value="roster">Roster</Tab>
 *     <Tab value="titles">Titles</Tab>
 *   </TabList>
 *   <TabPanel value="roster">...</TabPanel>
 *   <TabPanel value="titles">...</TabPanel>
 * </Tabs>
 * ```
 */
export function Tabs({
  value,
  defaultValue,
  onChange,
  activation = 'auto',
  className,
  children,
}: TabsProps) {
  const baseId = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');
  const isControlled = value !== undefined;
  const selectedValue = isControlled ? value : uncontrolledValue;

  const select = useCallback(
    (nextValue: string) => {
      if (!isControlled) setUncontrolledValue(nextValue);
      if (nextValue !== selectedValue) onChange?.(nextValue);
    },
    [isControlled, onChange, selectedValue],
  );

  const contextValue = useMemo(
    () => ({ baseId, selectedValue, activation, select }),
    [baseId, selectedValue, activation, select],
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className={classNames(styles['tabs'], className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps {
  /** Accessible name for the strip, when no visible heading names it. */
  readonly label?: string;
  /** Id of a visible element that names the strip. Takes the place of `label`. */
  readonly labelledBy?: string;
  readonly className?: string;
  /** The `Tab`s, in order. */
  readonly children: ReactNode;
}

interface OverflowEdges {
  readonly start: boolean;
  readonly end: boolean;
}

/** Pixels of slack so sub-pixel scroll positions do not leave a fade showing at an edge. */
const EDGE_TOLERANCE_PX = 1;

/**
 * Which ends of the strip have tabs scrolled out of view, so CSS can fade those edges. Kept in
 * data attributes rather than inline styles.
 */
function useOverflowEdges(element: HTMLElement | null): OverflowEdges {
  const [edges, setEdges] = useState<OverflowEdges>({ start: false, end: false });

  useEffect(() => {
    if (element === null) return undefined;

    const update = () => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      // Right-to-left strips report negative scroll positions; the distance from the start is the same.
      const scrolled = Math.abs(element.scrollLeft);
      const start = scrolled > EDGE_TOLERANCE_PX;
      const end = maxScroll - scrolled > EDGE_TOLERANCE_PX;
      setEdges((previous) =>
        previous.start === start && previous.end === end ? previous : { start, end },
      );
    };

    update();
    element.addEventListener('scroll', update, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resizeObserver?.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      resizeObserver?.disconnect();
    };
  }, [element]);

  return edges;
}

/**
 * The strip of tabs. It never wraps: when the tabs do not fit (most often on a phone) the strip
 * scrolls sideways inside itself, snapping to tabs, with the clipped edges faded out.
 */
export function TabList({ label, labelledBy, className, children }: TabListProps) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const edges = useOverflowEdges(listElement);

  return (
    <div
      ref={setListElement}
      role="tablist"
      aria-orientation="horizontal"
      aria-label={labelledBy === undefined ? label : undefined}
      aria-labelledby={labelledBy}
      className={classNames(styles['list'], className)}
      data-fade-start={edges.start ? '' : undefined}
      data-fade-end={edges.end ? '' : undefined}
    >
      {children}
    </div>
  );
}

export interface TabProps {
  /** Identifies the tab and its `TabPanel`. */
  readonly value: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The enabled tabs of the strip that holds `tab`, in order. */
function siblingTabs(tab: HTMLElement): HTMLElement[] {
  const list = tab.closest('[role="tablist"]');
  if (list === null) return [tab];
  return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')).filter(
    (candidate) => candidate.closest('[role="tablist"]') === list,
  );
}

function isRightToLeft(element: HTMLElement): boolean {
  return window.getComputedStyle(element).direction === 'rtl';
}

/** Index of the tab a navigation key moves to, or null for keys the tab strip does not use. */
function targetIndex(
  key: string,
  currentIndex: number,
  count: number,
  rtl: boolean,
): number | null {
  const forward = (currentIndex + 1) % count;
  const backward = (currentIndex - 1 + count) % count;
  switch (key) {
    case 'ArrowRight':
      return rtl ? backward : forward;
    case 'ArrowLeft':
      return rtl ? forward : backward;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** One tab. Only the selected tab is in the Tab order; the arrow keys reach the others. */
export function Tab({ value, disabled = false, className, children }: TabProps) {
  const { baseId, selectedValue, activation, select } = useTabsContext('Tab');
  const isSelected = value === selectedValue;

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tab = event.currentTarget;
    const tabs = siblingTabs(tab);
    const currentIndex = tabs.indexOf(tab);
    if (currentIndex === -1) return;

    const nextIndex = targetIndex(event.key, currentIndex, tabs.length, isRightToLeft(tab));
    const nextTab = nextIndex === null ? undefined : tabs[nextIndex];
    if (nextTab === undefined) return;

    event.preventDefault();
    nextTab.focus();
    const nextValue = nextTab.dataset['tabValue'];
    if (activation === 'auto' && nextValue !== undefined) select(nextValue);
  };

  return (
    <button
      type="button"
      role="tab"
      id={tabId(baseId, value)}
      aria-selected={isSelected}
      aria-controls={panelId(baseId, value)}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      data-tab-value={value}
      className={classNames(styles['tab'], className)}
      onClick={() => {
        select(value);
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps {
  /** The `Tab` this panel belongs to. */
  readonly value: string;
  /**
   * Keep the content mounted while another tab is selected, so its state (scroll position, form
   * input) survives switching. Off by default: hidden panels render nothing inside.
   */
  readonly keepMounted?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/** The content for one tab. Hidden unless its tab is selected. */
export function TabPanel({ value, keepMounted = false, className, children }: TabPanelProps) {
  const { baseId, selectedValue } = useTabsContext('TabPanel');
  const isSelected = value === selectedValue;

  return (
    <div
      role="tabpanel"
      id={panelId(baseId, value)}
      aria-labelledby={tabId(baseId, value)}
      hidden={!isSelected}
      tabIndex={0}
      className={classNames(styles['panel'], className)}
    >
      {(isSelected || keepMounted) && children}
    </div>
  );
}
