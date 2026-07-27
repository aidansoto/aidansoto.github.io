import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed port and should not have vite obscuring rust errors.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Modern macOS WKWebView.
    target: 'safari15',
    minify: 'esbuild',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
