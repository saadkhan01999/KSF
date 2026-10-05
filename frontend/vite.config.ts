import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined> };
/* Vite injects this into the config it bundles, ES module or not. */
declare const __dirname: string;

const apiPort = Number(process.env.KSF_API_PORT ?? 8790);

/* This folder. Everything below is relative to it, so the dev server and the
   build behave the same whether Vite is started from the project root
   (`npm run dev:web`) or from inside frontend/ (`npm run dev`). */
const here = __dirname;

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: here,
  publicDir: 'public',

  /* --------------------------------------------------------------------------
     Where Vite looks for .env — and where it must not.

     KSF's `.env` is the *server's* file: the database password, the SMTP
     account, the payment keys. It also carries NODE_ENV, and the shipped
     `.env.example` sets that to `development`, which is right for the person
     who copies it on their own machine.

     Vite treats NODE_ENV inside a .env file as authoritative. Left pointing at
     the project root, `npm run build` therefore produced a **development build
     of React** — twice the size, slower, and printing development warnings to
     the console — on any machine whose .env said so. It was found by building
     the release archive, where there is no .env, and noticing that the bundle
     came out half the size.

     Pointing envDir at the frontend removes the coupling: a server setting
     cannot change the client build. Anything the browser is meant to see goes
     in `frontend/.env` with a VITE_ prefix, which is where it belongs.
     -------------------------------------------------------------------------- */
  envDir: here,

  server: {
    port: 5180,
    host: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true
      }
    }
  },
  preview: { port: 4180, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200
  },

  /* --------------------------------------------------------------------------
     Belt as well as braces — but only for the build.

     Pinning NODE_ENV means that even if something else sets it, what ships is
     the production React. It must NOT apply to the dev server: react-refresh
     wraps its entire runtime in `if (process.env.NODE_ENV !== 'production')`,
     so folding that to `false` compiles the module down to `if (false) {}`,
     exports nothing, and `injectIntoGlobalHook is not a function` stops every
     module that imports React from evaluating. The page then sits empty until
     boot.js gives up and shows the recovery card.

     That is not a hypothetical: this config had the define unconditionally for
     about an hour, and that is exactly what it did. `npm run dev` now checks
     the served runtime before it says KSF is ready.
     -------------------------------------------------------------------------- */
  define: command === 'build'
    ? { 'process.env.NODE_ENV': JSON.stringify('production') }
    : {}
}));
