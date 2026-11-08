/**
 * `HTMLDialogElement.showModal()` and `close()` for jsdom, which has the element but not the
 * methods.
 *
 * The stub follows the browser closely enough for component tests: `showModal` sets `open` and
 * puts the dialog on a stack, `close` removes it and fires a `close` event, and Escape anywhere in
 * the document fires a cancelable `cancel` event at the topmost modal dialog, closing it unless a
 * listener calls `preventDefault()`. Focus trapping and the top layer are not emulated; the
 * Playwright specs cover those in a real browser.
 */

const modalStack: HTMLDialogElement[] = [];

function removeFromStack(dialog: HTMLDialogElement): void {
  const index = modalStack.indexOf(dialog);
  if (index !== -1) modalStack.splice(index, 1);
}

function showModal(this: HTMLDialogElement): void {
  if (!this.isConnected) {
    throw new DOMException('The dialog is not in a document.', 'InvalidStateError');
  }
  if (this.open) return;
  this.setAttribute('open', '');
  modalStack.push(this);
}

function close(this: HTMLDialogElement, returnValue?: string): void {
  if (!this.open) return;
  this.removeAttribute('open');
  removeFromStack(this);
  if (returnValue !== undefined) this.returnValue = returnValue;
  this.dispatchEvent(new Event('close'));
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  // A dialog removed from the document without close() is closed too, as in a browser.
  for (const dialog of [...modalStack]) {
    if (!dialog.isConnected) removeFromStack(dialog);
  }
  const topmost = modalStack.at(-1);
  if (topmost === undefined) return;

  const cancelEvent = new Event('cancel', { cancelable: true });
  topmost.dispatchEvent(cancelEvent);
  if (!cancelEvent.defaultPrevented) topmost.close();
}

/** Puts the stub on `HTMLDialogElement.prototype` once. Called from the test setup file. */
export function installDialogPolyfill(): void {
  const prototype = HTMLDialogElement.prototype;
  if (typeof prototype.showModal === 'function') return;

  Object.defineProperty(prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: showModal,
  });
  Object.defineProperty(prototype, 'close', { configurable: true, writable: true, value: close });
  document.addEventListener('keydown', handleEscape);
}

/** Forgets every open modal between tests. */
export function resetDialogPolyfill(): void {
  modalStack.length = 0;
}
