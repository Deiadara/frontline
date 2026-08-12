import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Explicit unmount between tests (RTL's auto-cleanup only runs with test globals).
afterEach(() => cleanup());
