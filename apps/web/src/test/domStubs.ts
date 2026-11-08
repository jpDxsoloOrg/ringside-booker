/**
 * Browser APIs jsdom does not have but the Radix primitives call: pointer capture (Select and
 * Switch), `scrollIntoView` (Select keeps the highlighted option in view) and `ResizeObserver`
 * (the popper that positions menus, popovers and tooltips). The stubs do nothing; layout and
 * positioning are checked by the Playwright specs in a real browser.
 *
 * jsdom also has `<dialog>` without its methods. `showModal`, `show` and `close` only toggle the
 * `open` attribute (and `close` fires the close event); the top layer and inertness are browser
 * behaviour the Playwright specs see.
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

function openDialog(this: HTMLDialogElement): void {
  this.setAttribute('open', '');
}

function closeDialog(this: HTMLDialogElement): void {
  if (!this.hasAttribute('open')) return;
  this.removeAttribute('open');
  this.dispatchEvent(new Event('close'));
}

/** Installs the stubs once. Called from the test setup file. */
export function installDomStubs(): void {
  const dialogPrototype = HTMLDialogElement.prototype;
  defineIfMissing(dialogPrototype, 'showModal', openDialog);
  defineIfMissing(dialogPrototype, 'show', openDialog);
  defineIfMissing(dialogPrototype, 'close', closeDialog);
  const elementPrototype = Element.prototype;
  defineIfMissing(elementPrototype, 'hasPointerCapture', () => false);
  defineIfMissing(elementPrototype, 'setPointerCapture', () => undefined);
  defineIfMissing(elementPrototype, 'releasePointerCapture', () => undefined);
  defineIfMissing(elementPrototype, 'scrollIntoView', () => undefined);
  defineIfMissing(globalThis, 'ResizeObserver', ResizeObserverStub);
}
