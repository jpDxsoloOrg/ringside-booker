/**
 * Browser APIs jsdom does not have but the Radix primitives call: pointer capture (Select and
 * Switch), `scrollIntoView` (Select keeps the highlighted option in view) and `ResizeObserver`
 * (the popper that positions menus, popovers and tooltips). The stubs do nothing; layout and
 * positioning are checked by the Playwright specs in a real browser.
 */

class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    // jsdom has no layout, so nothing ever resizes.
  }

  unobserve(): void {
    // Nothing is observed.
  }

  disconnect(): void {
    // Nothing is observed.
  }
}

function defineIfMissing(target: object, name: string, value: unknown): void {
  if (name in target) return;
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
}

/** Installs the stubs once. Called from the test setup file. */
export function installDomStubs(): void {
  const elementPrototype = Element.prototype;
  defineIfMissing(elementPrototype, 'hasPointerCapture', () => false);
  defineIfMissing(elementPrototype, 'setPointerCapture', () => undefined);
  defineIfMissing(elementPrototype, 'releasePointerCapture', () => undefined);
  defineIfMissing(elementPrototype, 'scrollIntoView', () => undefined);
  defineIfMissing(globalThis, 'ResizeObserver', ResizeObserverStub);
}
