import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

function realApiProxyPlugin(apiOrigin: string): Plugin {
  let apiTarget: URL;
  try {
    apiTarget = new URL(apiOrigin);
  } catch {
    throw new Error('CODEX_API_ORIGIN must be an absolute http or https URL.');
  }
  if (!['http:', 'https:'].includes(apiTarget.protocol)) {
    throw new Error('CODEX_API_ORIGIN must use http or https.');
  }

  return {
    name: 'codex-real-api-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api')) return next();

        let body: Buffer | undefined;
        if (!['GET', 'HEAD'].includes(req.method || '')) {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          body = Buffer.concat(chunks);
        }

        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) {
            if (value && !['host', 'connection', 'content-length'].includes(name.toLowerCase())) {
              headers.set(name, Array.isArray(value) ? value.join(', ') : value);
            }
          }
          if (req.headers.host) headers.set('x-forwarded-host', req.headers.host);
          headers.set('x-forwarded-proto', 'http');
          const upstream = await fetch(new URL(req.url, apiTarget), {
            method: req.method,
            headers,
            body: body ? new Uint8Array(body) : undefined,
            redirect: 'manual',
          });
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, name) => {
            if (!['connection', 'content-encoding', 'content-length', 'keep-alive', 'transfer-encoding'].includes(name.toLowerCase())) {
              res.setHeader(name, value);
            }
          });
          const setCookies = upstream.headers.getSetCookie?.();
          if (setCookies?.length) res.setHeader('set-cookie', setCookies);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (error) {
          console.error('[codex-api-proxy] Real API request failed:', error);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: 'The configured real API could not be reached.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = env.CODEX_API_ORIGIN || process.env.CODEX_API_ORIGIN || 'http://127.0.0.1:8787';
  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      tailwindcss(),
      realApiProxyPlugin(apiOrigin),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
    },
  };
});
