// Vitest setup for the web app: DOM matchers, matchMedia and DOM API stubs, an in-memory IndexedDB
// for the save storage tests, and a clean slate per test.
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installDomStubs } from './domStubs';
import { installMatchMedia, resetMatchMedia } from './matchMedia';

// A few tests (the lint guards) opt into the Node environment, where there is no window to stub.
const hasDom = typeof window !== 'undefined';

if (hasDom) {
  // jsdom has no scrolling; RouteFocus scrolls on every navigation.
  window.scrollTo = () => undefined;
  installMatchMedia();
  installDomStubs();
}

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  resetMatchMedia();
});
