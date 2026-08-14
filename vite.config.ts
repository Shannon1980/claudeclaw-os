import { defineConfig, loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'path';

// Vite builds the new Mission Control frontend from web/ into dist/web/.
// The Hono backend at src/dashboard.ts serves dist/web/index.html at the
// `/` route when DASHBOARD_LEGACY is not set to "true". Existing endpoints
// keep their shape; this is purely an additive frontend swap.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const dashboardPort = env.DASHBOARD_PORT || process.env.DASHBOARD_PORT || '3141';
  const backend = `http://127.0.0.1:${dashboardPort}`;

  return {
    root: 'web',
    plugins: [
      preact(),
      tailwind(),
      {
        name: 'warn-if-api-down',
        configureServer(server) {
          const check = () => {
            fetch(`${backend}/api/health`).catch(() => {
              server.config.logger.warn(
                `\n  ClaudeClaw API is not reachable at ${backend}.\n  Mission Control will fail to load until you start the backend (\`npm run dev\`).\n`,
              );
            });
          };
          if (server.httpServer) {
            server.httpServer.once('listening', check);
          } else {
            setTimeout(check, 300);
          }
        },
      },
    ],
    define: {
      'import.meta.env.VITE_BACKEND_ORIGIN': JSON.stringify(backend),
    },
    build: {
      outDir: '../dist/web',
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          // Single-page app: keep entry chunk tight, code-split routes lazily.
          manualChunks: {
            vendor: ['preact', '@preact/signals', 'wouter-preact', 'lucide-preact'],
          },
        },
      },
    },
    server: {
      // Default Vite port; 5173 is commonly taken by other local apps.
      port: 5174,
      strictPort: false,
      proxy: {
        // Proxy API calls to the running Hono dashboard so the new frontend
        // can hit real endpoints without CORS gymnastics. Honor DASHBOARD_PORT
        // from .env; a hardcoded :3141 proxy is why Mission Control shows
        // TypeError: Failed to fetch when the backend is on another port.
        '/api': backend,
        '/ws': { target: backend, ws: true },
        // The text war room is served as a legacy HTML page by the backend
        // at /warroom/text. Anything under /warroom/text/* goes straight
        // through to backend so meetings still open from the v2 launcher.
        '/warroom/text': backend,
        '/warroom-music': backend,
        '/warroom-client.js': backend,
        '/warroom-avatar': backend,
        '/warroom-test-audio': backend,
        '/warroom-music-upload': backend,
      },
    },
    resolve: {
      alias: {
        '@claudeclaw/models': resolve(__dirname, 'src/models.ts'),
        '@': resolve(__dirname, 'web/src'),
        // Wouter pulls in `react` shims; alias to preact/compat for the few
        // places it asks. preset-vite handles this automatically for most
        // libraries but we keep this explicit for safety.
        react: 'preact/compat',
        'react-dom': 'preact/compat',
      },
    },
  };
});
