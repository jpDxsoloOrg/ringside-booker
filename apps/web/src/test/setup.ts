// Vitest setup for the web app: DOM matchers, a matchMedia stub, and a clean slate per test.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installMatchMedia, resetMatchMedia } from './matchMedia';

// A few tests (the lint guards) opt into the Node environment, where there is no window to stub.
const hasDom = typeof window !== 'undefined';

if (hasDom) installMatchMedia();

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  resetMatchMedia();
});
