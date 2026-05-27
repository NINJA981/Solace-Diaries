import express from 'express';
import path from 'path';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import apiRouter from './server/routes';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Mount CORS first to handle pre-flight requests
  app.use(cors({
    origin: process.env.APP_URL || '*',
    credentials: true
  }));

  // Core payload parsers
  app.use(express.json());

  // Mount API endpoints first
  app.use('/api', apiRouter);

  // Vite static vs HMR middleware configuration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Haven Journal] Server active at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Critical server startup failure:', err);
});
