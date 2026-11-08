import type { Page } from '@playwright/test';

/**
 * WCAG 2.2 asks a focus indicator for 3:1 against what it sits on (1.4.11, 2.4.13), and at least a
 * 2px ring. These are the numbers the check holds every focused control to.
 */
export const FOCUS_RING_MIN_CONTRAST = 3;
export const FOCUS_RING_MIN_WIDTH_PX = 2;

/** What the check found for the element that has focus. */
export interface FocusRingReport {
  /** A short readable description of the focused element, for failure messages. */
  readonly target: string;
  /** False when focus sits on the page body or inside a frame, where there is nothing to check. */
  readonly checked: boolean;
  /** Each way the ring falls short. Empty when it passes. */
  readonly problems: readonly string[];
}

/** Arguments handed into the browser, where the check runs. */
interface FocusCheckLimits {
  readonly minContrast: number;
  readonly minWidthPx: number;
}

/**
 * Checks the keyboard focus ring on whatever element has focus now. The ring passes when the
 * element (or, for composite controls, a close ancestor or a child that draws it) shows a solid
 * outline at least 2px wide, the outline's colour has 3:1 contrast against the surface it is drawn
 * on, and no ancestor that clips its overflow cuts the ring off. A glow (box-shadow) on its own
 * also counts as an indicator, but only an outline is measured for contrast and clipping.
 */
export async function inspectFocusRing(page: Page): Promise<FocusRingReport> {
  const limits: FocusCheckLimits = {
    minContrast: FOCUS_RING_MIN_CONTRAST,
    minWidthPx: FOCUS_RING_MIN_WIDTH_PX,
  };
  return page.evaluate(({ minContrast, minWidthPx }) => {
    interface Rgba {
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    }

    function parseColour(value: string): Rgba | null {
      const channels = value.match(/[\d.]+/g);
      if (channels === null || channels.length < 3) return null;
      return {
        red: Number(channels[0]),
        green: Number(channels[1]),
        blue: Number(channels[2]),
        alpha: channels.length >= 4 ? Number(channels[3]) : 1,
      };
    }

    /** `top` laid over `bottom` with `top`'s alpha. */
    function composite(top: Rgba, bottom: Rgba): Rgba {
      const mix = (upper: number, lower: number): number =>
        upper * top.alpha + lower * (1 - top.alpha);
      return {
        red: mix(top.red, bottom.red),
        green: mix(top.green, bottom.green),
        blue: mix(top.blue, bottom.blue),
        alpha: 1,
      };
    }

    function luminance(colour: Rgba): number {
      const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return (
        0.2126 * linear(colour.red) + 0.7152 * linear(colour.green) + 0.0722 * linear(colour.blue)
      );
    }

    function contrast(first: Rgba, second: Rgba): number {
      const lighter = Math.max(luminance(first), luminance(second));
      const darker = Math.min(luminance(first), luminance(second));
      return (lighter + 0.05) / (darker + 0.05);
    }

    /** The solid colour behind `start`: its background and every ancestor's, blended upwards. */
    function surfaceBehind(start: Element | null): Rgba {
      const layers: Rgba[] = [];
      for (let element = start; element !== null; element = element.parentElement) {
        const background = parseColour(window.getComputedStyle(element).backgroundColor);
        if (background !== null && background.alpha > 0) {
          layers.push(background);
          if (background.alpha >= 1) break;
        }
      }
      let colour: Rgba = { red: 255, green: 255, blue: 255, alpha: 1 };
      for (const layer of layers.reverse()) colour = composite(layer, colour);
      return colour;
    }

    function describe(element: Element): string {
      const role = element.getAttribute('role');
      const name =
        element.getAttribute('aria-label') ??
        element.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      return `<${element.tagName.toLowerCase()}${role === null ? '' : ` role=${role}`}> "${name}"`;
    }

    interface Ring {
      readonly element: Element;
      readonly style: CSSStyleDeclaration;
    }

    function outlineOf(element: Element): Ring | null {
      const style = window.getComputedStyle(element);
      if (style.outlineStyle === 'none' || parseFloat(style.outlineWidth) <= 0) return null;
      return { element, style };
    }

    /** The element drawing the ring: the focused one, a close ancestor, or a child (a row). */
    function findRing(focused: Element): Ring | null {
      const own = outlineOf(focused);
      if (own !== null) return own;
      let ancestor = focused.parentElement;
      for (let depth = 0; depth < 3 && ancestor !== null; depth += 1) {
        const ring = outlineOf(ancestor);
        if (ring !== null) return ring;
        ancestor = ancestor.parentElement;
      }
      for (const child of Array.from(focused.children)) {
        const ring = outlineOf(child);
        if (ring !== null) return ring;
      }
      return null;
    }

    const focused = document.activeElement;
    if (focused === null || focused === document.body || focused.tagName === 'IFRAME') {
      return { target: 'nothing', checked: false, problems: [] };
    }

    const problems: string[] = [];
    const ring = findRing(focused);
    const hasGlow = window.getComputedStyle(focused).boxShadow !== 'none';

    // WCAG 2.2 focus not obscured: some of the focused control must show, not sit wholly under
    // a fixed bar or outside the screen. Probe its centre and four points just inside its corners.
    const focusedBox = focused.getBoundingClientRect();
    const drawnBy = ring?.element ?? focused;
    const inset = Math.min(4, focusedBox.width / 4, focusedBox.height / 4);
    const probes: readonly (readonly [number, number])[] = [
      [focusedBox.left + focusedBox.width / 2, focusedBox.top + focusedBox.height / 2],
      [focusedBox.left + inset, focusedBox.top + inset],
      [focusedBox.right - inset, focusedBox.top + inset],
      [focusedBox.left + inset, focusedBox.bottom - inset],
      [focusedBox.right - inset, focusedBox.bottom - inset],
    ];
    const shows = probes.some(([pointX, pointY]) => {
      const hit = document.elementFromPoint(pointX, pointY);
      return (
        hit !== null && (focused.contains(hit) || hit.contains(focused) || drawnBy.contains(hit))
      );
    });
    if (!shows) problems.push('hidden behind other content or off screen');

    if (ring === null) {
      if (!hasGlow) problems.push('no visible focus indicator');
      return { target: describe(focused), checked: true, problems };
    }

    const width = parseFloat(ring.style.outlineWidth);
    const offset = parseFloat(ring.style.outlineOffset);
    if (width < minWidthPx) problems.push(`ring is ${String(width)}px wide`);

    // An outset ring is drawn on the surface around the element, an inset one on the element.
    const surface = surfaceBehind(offset >= 0 ? ring.element.parentElement : ring.element);
    const ringColour = parseColour(ring.style.outlineColor);
    if (ringColour !== null) {
      const ratio = contrast(composite(ringColour, surface), surface);
      if (ratio < minContrast) problems.push(`ring contrast is ${ratio.toFixed(2)}:1`);
    }

    // Any ancestor that clips its overflow must leave room for the whole ring.
    const reach = Math.max(0, offset + width);
    const box = ring.element.getBoundingClientRect();
    const tolerance = 0.5;
    for (
      let ancestor = ring.element.parentElement;
      ancestor !== null && ancestor !== document.documentElement;
      ancestor = ancestor.parentElement
    ) {
      const style = window.getComputedStyle(ancestor);
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const clip = ancestor.getBoundingClientRect();
      const left = clip.left + ancestor.clientLeft;
      const top = clip.top + ancestor.clientTop;
      const right = left + ancestor.clientWidth;
      const bottom = top + ancestor.clientHeight;
      const cutX =
        clipsX && (box.left - reach < left - tolerance || box.right + reach > right + tolerance);
      const cutY =
        clipsY && (box.top - reach < top - tolerance || box.bottom + reach > bottom + tolerance);
      if (cutX || cutY) {
        problems.push(`ring is clipped by ${describe(ancestor).slice(0, 60)}`);
        break;
      }
    }

    return { target: describe(focused), checked: true, problems };
  }, limits);
}

/** Attribute stamped on each element the Tab walk visits, so it can tell when focus wraps. */
const VISITED_ATTRIBUTE = 'data-focus-ring-visited';

/** Where focus is after one Tab press. */
interface FocusStop {
  /** Focus is inside the container the walk checks. */
  readonly inside: boolean;
  /** The element had already been visited: focus has wrapped around. */
  readonly repeated: boolean;
}

async function readFocusStop(page: Page, selector: string): Promise<FocusStop> {
  return page.evaluate(
    ({ containerSelector, visitedAttribute }) => {
      const focused = document.activeElement;
      const inside =
        focused !== null &&
        focused !== document.body &&
        (document.querySelector(containerSelector)?.contains(focused) ?? false);
      if (!inside) return { inside, repeated: false };
      const repeated = focused.hasAttribute(visitedAttribute);
      focused.setAttribute(visitedAttribute, '');
      return { inside, repeated };
    },
    { containerSelector: selector, visitedAttribute: VISITED_ATTRIBUTE },
  );
}

/**
 * Presses Tab and checks the focus ring at every stop inside `selector`, until focus leaves the
 * container after entering it, comes back round to a stop it already checked, or `maxStops` is
 * reached. Returns how many stops it checked and one line per stop whose ring falls short.
 */
export async function tabThroughAndCheckRings(
  page: Page,
  selector: string,
  maxStops: number,
): Promise<{ readonly stops: number; readonly failures: readonly string[] }> {
  const failures: string[] = [];
  let stops = 0;
  let entered = false;
  for (let press = 0; press < maxStops * 2 && stops < maxStops; press += 1) {
    await page.keyboard.press('Tab');
    const stop = await readFocusStop(page, selector);
    if (!stop.inside) {
      if (entered) break;
      continue;
    }
    if (stop.repeated) break;
    entered = true;
    stops += 1;
    const report = await inspectFocusRing(page);
    if (report.checked && report.problems.length > 0) {
      failures.push(`${report.target}: ${report.problems.join('; ')}`);
    }
  }
  return { stops, failures };
}
