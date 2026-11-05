import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * O Commercial Workspace resolve o Pricing Engine pela sua FONTE TypeScript (Vite transpila),
 * mantendo tipos vivos e um motor só — sem build intermediário em dev. A Render compila o mesmo
 * source no build (§27.1: pacotes compartilhados resolvidos no build).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@bondly/pricing-engine': fileURLToPath(
        new URL('../../packages/pricing-engine/src/index.ts', import.meta.url),
      ),
      '@bondly/pricing-types': fileURLToPath(
        new URL('../../packages/pricing-types/src/index.ts', import.meta.url),
      ),
      '@bondly/pricing-catalog': fileURLToPath(
        new URL('../../packages/pricing-catalog/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  build: { outDir: 'dist', sourcemap: false /* G-001: sem .map no build */ },
});
