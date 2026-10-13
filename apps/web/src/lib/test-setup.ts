// Vitest setup for the web app (jsdom). Unmounts React trees between tests.
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
