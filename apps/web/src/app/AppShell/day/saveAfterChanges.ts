/**
 * Saves the game shortly after the player changes it (SAVE-01).
 *
 * A save can't be finished as the page closes: the engine runs in a worker and saves go to
 * IndexedDB, and neither outlives `pagehide`. So the shell saves after each change instead, on a
 * short debounce so a burst of edits writes once, and off the critical path: a change only starts
 * a timer, and the save waits while the engine is busy (a day advance, a load, another command).
 *
 * This class is the timing only; the caller supplies the save itself and reports its outcome.
 */

/** How long after the last change the save starts. */
export const SAVE_AFTER_CHANGES_DELAY_MS = 750;

export interface SaveAfterChangesOptions {
  /** Writes the save. It should not throw; a throw counts as done (the caller reports failures). */
  readonly save: () => Promise<void>;
  /** False while the save has to wait, such as during a day advance; it then tries again later. */
  readonly canSave: () => boolean;
  /** Told when unsaved changes appear (true) and once they are all saved or dropped (false). */
  readonly onPendingChange?: (pending: boolean) => void;
  readonly delayMs?: number;
}

export class SaveAfterChanges {
  readonly #save: () => Promise<void>;
  readonly #canSave: () => boolean;
  readonly #onPendingChange: ((pending: boolean) => void) | undefined;
  readonly #delayMs: number;
  #timer: ReturnType<typeof setTimeout> | undefined = undefined;
  /** A change has happened since the last save started. */
  #dirty = false;
  #inFlight: Promise<void> | null = null;
  #pending = false;
  #disposed = false;

  constructor(options: SaveAfterChangesOptions) {
    this.#save = options.save;
    this.#canSave = options.canSave;
    this.#onPendingChange = options.onPendingChange;
    this.#delayMs = options.delayMs ?? SAVE_AFTER_CHANGES_DELAY_MS;
  }

  /** True from a change until a save that started after it has finished. */
  get pending(): boolean {
    return this.#pending;
  }

  /** The game changed: save after the delay, restarting it if a save was already waiting. */
  noteChange(): void {
    if (this.#disposed) return;
    this.#dirty = true;
    this.#setPending(true);
    this.#schedule();
  }

  /**
   * Saves now if anything is unsaved and the engine is free, such as when the page is hidden.
   * Resolves once the save (or the one already running) has finished.
   */
  async flush(): Promise<void> {
    if (this.#disposed) return;
    if (this.#inFlight !== null) {
      await this.#inFlight;
      return;
    }
    if (!this.#dirty || !this.#canSave()) return;
    this.#clearTimer();
    await this.#start();
  }

  /** Forgets unsaved changes, such as when another game is loaded. A running save finishes. */
  cancel(): void {
    this.#clearTimer();
    this.#dirty = false;
    if (this.#inFlight === null) this.#setPending(false);
  }

  /** Stops for good: no timer fires after this. */
  dispose(): void {
    this.cancel();
    this.#disposed = true;
  }

  #schedule(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#fire();
    }, this.#delayMs);
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #fire(): void {
    if (this.#disposed || !this.#dirty) return;
    // One save at a time; a change during a save is picked up when it ends. A busy engine waits.
    if (this.#inFlight !== null || !this.#canSave()) {
      this.#schedule();
      return;
    }
    void this.#start();
  }

  async #start(): Promise<void> {
    this.#dirty = false;
    const run = this.#run();
    this.#inFlight = run;
    await run;
  }

  async #run(): Promise<void> {
    try {
      await this.#save();
    } catch {
      // The caller's save reports its own failures.
    }
    this.#inFlight = null;
    if (this.#disposed) return;
    if (this.#dirty) {
      this.#schedule();
    } else {
      this.#setPending(false);
    }
  }

  #setPending(pending: boolean): void {
    if (this.#pending === pending) return;
    this.#pending = pending;
    this.#onPendingChange?.(pending);
  }
}
