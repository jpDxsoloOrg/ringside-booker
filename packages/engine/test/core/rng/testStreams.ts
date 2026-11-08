/**
 * Stream names used only by the RNG tests. Declared the same way a system declares its own.
 */

declare module '@ringside/engine' {
  interface StreamNames {
    'test.alpha': true;
    'test.beta': true;
    'test.gamma': true;
    'test.seeds': true;
  }
}

export {};
