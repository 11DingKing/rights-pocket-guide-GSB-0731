import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The materials/ directory is served as static assets so the same JSON packs
// that ship in the repo are fetched at runtime and cached into IndexedDB.
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
