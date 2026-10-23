import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ConfigError, assertConfig } from './lib/config';
import { initAppearance } from './lib/theme';
import './styles/index.css';

// World and theme are already on <html> (theme-init.js); this keeps them right from here on.
initAppearance();
const root = createRoot(document.getElementById('root')!);

try {
  assertConfig();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error);
  root.render(
    <main className="mx-auto max-w-lg px-6 py-24">
      <h1 className="type-heading text-3xl">Solace isn’t configured</h1>
      <p className="mt-4 text-fg-muted">{error.message}</p>
    </main>,
  );
}
