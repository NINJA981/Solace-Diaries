import express from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
import { createServer as createViteServer } from 'vite';
import apiRouter from './server/routes';
import { initDb } from './server/db.client';

async function startServer() {
  // Test connection to postgres and resolve mocks if necessary
  await initDb();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Build allowed origins list from FRONTEND_URL env var
  const allowedOrigins: string[] = [];
  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL.replace(/\/$/, ''));
  }

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin) return callback(null, true);
      // In development, allow all origins
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      // In production, check against allowed list
      if (allowedOrigins.some(allowed => origin === allowed || origin.endsWith('.vercel.app'))) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }));

  // Core payload parsers
  app.use(express.json());

  // Mount API endpoints
  app.use('/api', apiRouter);

  // Serve static uploads folder directly at root path
  app.use('/uploads', express.static(path.join(process.cwd(), 'public', 'uploads')));

  // In development, use Vite's HMR middleware for the frontend
  // In production, the frontend is deployed separately on Vercel
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Solace Diaries] API server active at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Critical server startup failure:', err);
});
