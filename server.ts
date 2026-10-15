import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { initMongo } from './src/server/mongo.ts';
import { apiRouter } from './src/server/apiRouter.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use('/api', apiRouter);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  try {
    await initMongo();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[codex-dynamics] MongoDB unavailable; serving the UI with API requests disabled: ${message}`);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[codex-dynamics] Unified full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[codex-dynamics] Failed to start web server:', err);
  process.exit(1);
});
