import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function tracestrackProxyPlugin(): Plugin {
  const handler = async (req: any, res: any, next: any) => {
    const match = req.url?.match(/^\/api\/tiles\/topo\/(\d+)\/(\d+)\/(\d+)\.webp/);
    if (match) {
      const [, z, x, y] = match;
      const targetUrl = `https://tile.tracestrack.com/topo__/${z}/${x}/${y}.webp?key=383118983d4a867dd2d367451720d724`;
      try {
        const tileRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.openstreetmap.org/',
          },
        });
        if (tileRes.ok) {
          res.setHeader('Content-Type', 'image/webp');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('Access-Control-Allow-Origin', '*');
          const arrayBuf = await tileRes.arrayBuffer();
          res.end(Buffer.from(arrayBuf));
          return;
        }

        // Fallback to OpenTopoMap
        const fallbackUrl = `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
        const fallbackRes = await fetch(fallbackUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (fallbackRes.ok) {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.setHeader('Access-Control-Allow-Origin', '*');
          const arrayBuf = await fallbackRes.arrayBuffer();
          res.end(Buffer.from(arrayBuf));
          return;
        }
      } catch (e) {
        // pass to next
      }
    }
    next();
  };

  return {
    name: 'tracestrack-topo-proxy',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      tracestrackProxyPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon.svg', 'icon-maskable.svg', 'pwa-192x192.png', 'pwa-maskable-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: './',
          name: 'GPX generator by BOANSKA',
          short_name: 'GPX Generator',
          description: 'Generate and download GPX route files from map routes with Fog of World Dropbox import support.',
          theme_color: '#2563eb',
          background_color: '#2563eb',
          display: 'standalone',
          display_override: ['fullscreen', 'standalone', 'minimal-ui'],
          start_url: './',
          scope: './',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    define: {
      'process.env.GOOGLE_MAPS_PLATFORM_KEY': JSON.stringify(process.env.GOOGLE_MAPS_PLATFORM_KEY || '')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
