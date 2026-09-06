import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Tracestrack Topo tiles proxy from OpenStreetMap
  app.get('/api/tiles/topo/:z/:x/:y.webp', async (req, res) => {
    const { z, x, y } = req.params;
    const targetUrl = `https://tile.tracestrack.com/topo__/${z}/${x}/${y}.webp?key=383118983d4a867dd2d367451720d724`;

    try {
      const tileRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.openstreetmap.org/',
        },
      });

      if (tileRes.ok) {
        res.set('Content-Type', 'image/webp');
        res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        res.set('Access-Control-Allow-Origin', '*');
        const buffer = Buffer.from(await tileRes.arrayBuffer());
        return res.send(buffer);
      }

      // Graceful fallback to OpenTopoMap if Tracestrack is temporarily unreachable
      const fallbackUrl = `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (fallbackRes.ok) {
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('Access-Control-Allow-Origin', '*');
        const fallbackBuffer = Buffer.from(await fallbackRes.arrayBuffer());
        return res.send(fallbackBuffer);
      }

      return res.status(tileRes.status).send('Tile not available');
    } catch (err: any) {
      // If error occurs, try fallback
      try {
        const fallbackUrl = `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
        const fallbackRes = await fetch(fallbackUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (fallbackRes.ok) {
          res.set('Content-Type', 'image/png');
          res.set('Cache-Control', 'public, max-age=86400');
          res.set('Access-Control-Allow-Origin', '*');
          const fallbackBuffer = Buffer.from(await fallbackRes.arrayBuffer());
          return res.send(fallbackBuffer);
        }
      } catch {}
      return res.status(500).send(err.message);
    }
  });

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
