import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Explicit unmount between tests (RTL's auto-cleanup only runs with test globals).
afterEach(() => cleanup());

/*
 * jsdom ships no ResizeObserver, and it never reflows, so a real one would have nothing to
 * report anyway. Components that measure their own layout are asserted against in the e2e
 * suite, where the geometry is real; here the observer only has to exist.
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
