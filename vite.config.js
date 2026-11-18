import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001' },
  },
  // pdfjs-dist v4 ships modern syntax (top-level await, Promise.withResolvers)
  build: { outDir: '../dist', emptyOutDir: true, target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
