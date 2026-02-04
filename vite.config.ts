import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    electron({
      entry: {
        main: path.join(__dirname, 'electron/main.ts'),
        preload: path.join(__dirname, 'electron/preload.ts')
      }
    }),
    renderer()
  ],
  build: {
    outDir: 'dist'
  }
});
